CREATE OR REPLACE FUNCTION public.bulk_fix_invoice_divergence(
  p_invoice_ids uuid[],
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  invoice_id uuid,
  invoice_number text,
  status text,
  removed_lines integer,
  old_total numeric,
  new_total numeric,
  duplicate_amount numeric,
  expense_id uuid,
  old_expense_amount numeric,
  new_expense_amount numeric,
  ledger_debit numeric,
  needs_ledger_repost boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_inv record;
  v_removed integer;
  v_new_total numeric;
  v_old_total numeric;
  v_dup_amount numeric;
  v_exp_id uuid;
  v_exp_amount numeric;
  v_new_exp_amount numeric;
  v_ledger numeric;
  v_legs integer;
  v_needs_repost boolean;
  v_dup_groups jsonb;
  v_status text;
  v_message text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'accountant')
    OR public.has_role(auth.uid(), 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants can run the bulk reconcile and fix';
  END IF;

  IF p_invoice_ids IS NULL OR array_length(p_invoice_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOR v_inv IN
    SELECT pi.id, pi.invoice_number, pi.total_amount, pi.tax_amount
    FROM public.purchase_invoices pi
    WHERE pi.id = ANY(p_invoice_ids)
      AND pi.restaurant_id = v_tenant
    ORDER BY pi.invoice_date, pi.invoice_number
    FOR UPDATE
  LOOP
    v_removed := 0;
    v_status := 'fixed';
    v_message := NULL;
    v_needs_repost := false;
    v_old_total := ROUND(COALESCE(v_inv.total_amount, 0), 2);

    -- Duplicate detection: identical description / quantity / unit price / total.
    WITH grouped AS (
      SELECT COALESCE(ii.description, '') AS description,
             COALESCE(ii.quantity, 0) AS quantity,
             COALESCE(ii.unit_price, 0) AS unit_price,
             ROUND(COALESCE(ii.total_price, 0), 2) AS line_total,
             COUNT(*)::int AS occurrences
      FROM public.invoice_items ii
      WHERE ii.invoice_id = v_inv.id
      GROUP BY 1, 2, 3, 4
      HAVING COUNT(*) > 1
    )
    SELECT COALESCE(SUM(line_total * (occurrences - 1)), 0),
           COALESCE(
             jsonb_agg(jsonb_build_object(
               'description', description,
               'quantity', quantity,
               'unit_price', unit_price,
               'line_total', line_total,
               'occurrences', occurrences,
               'excess_amount', ROUND(line_total * (occurrences - 1), 2)
             )), '[]'::jsonb)
    INTO v_dup_amount, v_dup_groups
    FROM grouped;

    v_dup_amount := ROUND(COALESCE(v_dup_amount, 0), 2);

    IF NOT p_dry_run AND v_dup_amount > 0 THEN
      PERFORM set_config('app.invoice_items_rewrite', 'on', true);

      WITH ranked AS (
        SELECT ii.id,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(ii.description, ''),
                              COALESCE(ii.quantity, 0),
                              COALESCE(ii.unit_price, 0),
                              ROUND(COALESCE(ii.total_price, 0), 2)
                 ORDER BY ii.created_at NULLS LAST, ii.id
               ) AS rn
        FROM public.invoice_items ii
        WHERE ii.invoice_id = v_inv.id
      )
      DELETE FROM public.invoice_items d
      USING ranked r
      WHERE d.id = r.id AND r.rn > 1;

      GET DIAGNOSTICS v_removed = ROW_COUNT;

      PERFORM set_config('app.invoice_items_rewrite', 'off', true);
    END IF;

    -- Recompute the total from the (deduplicated) remaining lines.
    IF p_dry_run THEN
      SELECT ROUND(COALESCE(SUM(x.line_total), 0), 2) INTO v_new_total
      FROM (
        SELECT DISTINCT ON (COALESCE(ii.description, ''), COALESCE(ii.quantity, 0),
                            COALESCE(ii.unit_price, 0), ROUND(COALESCE(ii.total_price, 0), 2))
               ROUND(COALESCE(ii.total_price, 0), 2) AS line_total
        FROM public.invoice_items ii
        WHERE ii.invoice_id = v_inv.id
        ORDER BY COALESCE(ii.description, ''), COALESCE(ii.quantity, 0),
                 COALESCE(ii.unit_price, 0), ROUND(COALESCE(ii.total_price, 0), 2),
                 ii.created_at NULLS LAST, ii.id
      ) x;
      SELECT COUNT(*)::int INTO v_removed
      FROM public.invoice_items ii WHERE ii.invoice_id = v_inv.id;
      v_removed := GREATEST(
        v_removed - (SELECT COUNT(DISTINCT (COALESCE(description,''), COALESCE(quantity,0),
                                            COALESCE(unit_price,0), ROUND(COALESCE(total_price,0),2)))
                     FROM public.invoice_items WHERE invoice_id = v_inv.id), 0);
    ELSE
      SELECT ROUND(COALESCE(SUM(COALESCE(ii.total_price, 0)), 0), 2) INTO v_new_total
      FROM public.invoice_items ii WHERE ii.invoice_id = v_inv.id;
    END IF;

    IF NOT p_dry_run AND ABS(v_new_total - v_old_total) > 0.005 THEN
      UPDATE public.purchase_invoices
      SET subtotal = v_new_total - COALESCE(tax_amount, 0),
          total_amount = v_new_total,
          updated_at = now()
      WHERE id = v_inv.id;
    END IF;

    -- Linked expense + ledger state.
    SELECT e.id, ROUND(COALESCE(e.amount, 0), 2)
    INTO v_exp_id, v_exp_amount
    FROM public.expenses e
    WHERE e.purchase_invoice_id = v_inv.id
      AND e.tenant_id = v_tenant
      AND e.deleted_at IS NULL
    ORDER BY e.created_at
    LIMIT 1;

    v_ledger := NULL;
    v_legs := 0;
    IF v_exp_id IS NOT NULL THEN
      SELECT ROUND(SUM(COALESCE(at.debit, 0)), 2), COUNT(*)::int
      INTO v_ledger, v_legs
      FROM public.account_transactions at
      LEFT JOIN public.journal_entry_batches b ON b.id = at.batch_id
      WHERE at.tenant_id = v_tenant
        AND at.reference_type = 'expense'
        AND at.reference_id = v_exp_id
        AND COALESCE(at.is_voided, false) = false
        AND COALESCE(b.entry_type::text, '') <> 'payment'
        AND COALESCE(b.reference_number, '') NOT LIKE 'EXPPAY-%'
        AND COALESCE(b.reference_number, '') NOT LIKE 'APREMAP%';
    END IF;

    v_new_exp_amount := v_exp_amount;
    IF v_exp_id IS NOT NULL AND ABS(COALESCE(v_exp_amount, 0) - v_new_total) > 0.005 THEN
      IF COALESCE(v_legs, 0) = 0 THEN
        v_new_exp_amount := v_new_total;
        IF NOT p_dry_run THEN
          UPDATE public.expenses
          SET amount = v_new_total, updated_at = now()
          WHERE id = v_exp_id;
        END IF;
      ELSE
        -- Already posted: never rewrite a posted expense silently.
        v_needs_repost := true;
      END IF;
    END IF;

    IF COALESCE(v_legs, 0) > 0 AND ABS(COALESCE(v_ledger, 0) - v_new_total) > 0.005 THEN
      v_needs_repost := true;
    END IF;

    IF v_dup_amount = 0 AND ABS(v_new_total - v_old_total) <= 0.005
       AND COALESCE(v_new_exp_amount, 0) = COALESCE(v_exp_amount, 0) THEN
      v_status := CASE WHEN v_needs_repost THEN 'needs_ledger_repost' ELSE 'no_change' END;
      v_message := CASE
        WHEN v_needs_repost THEN 'Bill lines are clean but the posted ledger amount differs — void and repost the expense.'
        ELSE 'Nothing to fix on this bill.'
      END;
    ELSIF p_dry_run THEN
      v_status := 'would_fix';
      v_message := format('Would remove %s duplicate line(s) and set the total to %s.', v_removed, v_new_total);
    ELSE
      v_status := CASE WHEN v_needs_repost THEN 'fixed_needs_repost' ELSE 'fixed' END;
      v_message := format('Removed %s duplicate line(s); total %s -> %s.', v_removed, v_old_total, v_new_total)
        || CASE WHEN v_needs_repost THEN ' Posted ledger still shows the old amount — void and repost the expense.' ELSE '' END;
    END IF;

    IF NOT p_dry_run AND v_status LIKE 'fixed%' THEN
      INSERT INTO public.audit_logs (user_id, tenant_id, action, entity_type, entity_id, old_data, new_data)
      VALUES (
        auth.uid(), v_tenant, 'BULK_INVOICE_RECONCILE_FIX', 'purchase_invoice', v_inv.id,
        jsonb_build_object('total_amount', v_old_total, 'expense_amount', v_exp_amount,
                           'ledger_debit', v_ledger, 'duplicate_groups', v_dup_groups),
        jsonb_build_object('total_amount', v_new_total, 'expense_amount', v_new_exp_amount,
                           'removed_lines', v_removed, 'needs_ledger_repost', v_needs_repost)
      );
    END IF;

    invoice_id := v_inv.id;
    invoice_number := v_inv.invoice_number;
    status := v_status;
    removed_lines := COALESCE(v_removed, 0);
    old_total := v_old_total;
    new_total := v_new_total;
    duplicate_amount := v_dup_amount;
    expense_id := v_exp_id;
    old_expense_amount := v_exp_amount;
    new_expense_amount := v_new_exp_amount;
    ledger_debit := v_ledger;
    needs_ledger_repost := v_needs_repost;
    message := v_message;
    RETURN NEXT;

    v_exp_id := NULL; v_exp_amount := NULL; v_new_exp_amount := NULL;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.bulk_fix_invoice_divergence(uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_fix_invoice_divergence(uuid[], boolean) TO authenticated;