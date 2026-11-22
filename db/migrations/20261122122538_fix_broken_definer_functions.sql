-- Four functions that failed for real users (found in the 2026-11-22 caller-check audit,
-- docs/self-hosting/FUNCTION_ACCESS_REVIEW.md). Bodies are the current definitions with the marked fixes.
--   explain_imbalance:                 read journal batch columns that exist (failed with 42703)
--   bulk_fix_invoice_divergence:       match the business's invoices (compared a restaurant id with the business id);
--                                      qualify an invoice_id that clashed with the output column (42702)
--   remap_expenses_to_supplier_ap_head: check posting rights on the business, not the user id
--   request_terminal_state_refresh:    role check, return type and audit row used columns that do not exist

-- explain_imbalance
CREATE OR REPLACE FUNCTION public.explain_imbalance(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_exp RECORD;
  v_dr numeric; v_cr numeric; v_diff numeric;
  v_legs jsonb;
  v_batches jsonb;
  v_credit_code text; v_credit_acct_info jsonb;
  v_suggested jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT e.id, e.tenant_id, e.branch_id, e.amount, e.expense_date, e.status,
         e.description, e.account_id, b.name AS branch_name,
         coa.account_code, coa.account_name
    INTO v_exp
  FROM public.expenses e
  LEFT JOIN public.branches b ON b.id = e.branch_id
  LEFT JOIN public.chart_of_accounts coa ON coa.id = e.account_id
  WHERE e.id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  -- Caller must belong to the expense's business (the old <> check passed when either tenant was NULL).
  IF NOT (public.is_superadmin(v_actor) OR public.user_belongs_to_tenant(v_actor, v_exp.tenant_id)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT COALESCE(sum(t.debit),0), COALESCE(sum(t.credit),0)
    INTO v_dr, v_cr
  FROM public.account_transactions t
  WHERE t.reference_type='expense' AND t.reference_id = p_expense_id
    AND COALESCE(t.is_voided,false) = false;
  v_diff := round(v_dr - v_cr, 2);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'transaction_date', t.transaction_date,
    'debit', t.debit, 'credit', t.credit,
    'description', t.description, 'batch_id', t.batch_id,
    'is_voided', t.is_voided,
    'account_code', coa.account_code,
    'account_name', coa.account_name,
    'account_type', coa.account_type
  ) ORDER BY t.created_at), '[]'::jsonb) INTO v_legs
  FROM public.account_transactions t
  LEFT JOIN public.chart_of_accounts coa ON coa.id = t.account_id
  WHERE t.reference_type='expense' AND t.reference_id = p_expense_id;

  -- journal_entry_batches has no batch_number / entry_date / status / total_amount columns (the
  -- function failed with 42703 whenever it ran). Same output keys, read from the real columns.
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'batch_id', jb.id, 'batch_number', jb.reference_number,
    'description', jb.description, 'entry_date', jb.batch_date,
    'status', jb.approval_status,
    'total_amount', (SELECT sum(x.debit) FROM public.account_transactions x
                      WHERE x.batch_id = jb.id AND COALESCE(x.is_voided, false) = false)
  )), '[]'::jsonb) INTO v_batches
  FROM public.journal_entry_batches jb
  WHERE jb.id IN (
    SELECT DISTINCT batch_id FROM public.account_transactions
    WHERE reference_type='expense' AND reference_id = p_expense_id AND batch_id IS NOT NULL
  );

  IF v_diff > 0 AND abs(v_diff - v_exp.amount) <= 0.01 THEN
    v_credit_code := CASE WHEN COALESCE(v_exp.status,'unpaid') = 'paid' THEN '1000' ELSE '2000' END;
    SELECT jsonb_build_object(
      'id', id, 'account_code', account_code, 'account_name', account_name
    ) INTO v_credit_acct_info
    FROM public.chart_of_accounts
    WHERE tenant_id = v_exp.tenant_id AND account_code = v_credit_code LIMIT 1;

    v_suggested := jsonb_build_object(
      'pattern','missing_credit_leg',
      'fixable_automatically', v_credit_acct_info IS NOT NULL,
      'fields', ARRAY['credit'],
      'proposed_action',
        'Insert a credit of '||v_diff||' to account '||v_credit_code||
        ' ('||COALESCE(v_credit_acct_info->>'account_name','MISSING')||')',
      'credit_account', v_credit_acct_info,
      'credit_amount', v_diff
    );
  ELSE
    v_suggested := jsonb_build_object(
      'pattern','ambiguous',
      'fixable_automatically', false,
      'fields', ARRAY['debit','credit'],
      'proposed_action','Manual review required — diff does not match a known pattern.'
    );
  END IF;

  RETURN jsonb_build_object(
    'expense', jsonb_build_object(
      'id', v_exp.id,
      'description', v_exp.description,
      'amount', v_exp.amount,
      'expense_date', v_exp.expense_date,
      'status', v_exp.status,
      'branch_name', v_exp.branch_name,
      'account_code', v_exp.account_code,
      'account_name', v_exp.account_name
    ),
    'totals', jsonb_build_object('dr_total', v_dr, 'cr_total', v_cr, 'diff', v_diff),
    'batches', v_batches,
    'legs', v_legs,
    'suggested_fix', v_suggested
  );
END;
$function$;

-- bulk_fix_invoice_divergence
CREATE OR REPLACE FUNCTION public.bulk_fix_invoice_divergence(p_invoice_ids uuid[], p_dry_run boolean DEFAULT true)
 RETURNS TABLE(invoice_id uuid, invoice_number text, status text, removed_lines integer, old_total numeric, new_total numeric, duplicate_amount numeric, expense_id uuid, old_expense_amount numeric, new_expense_amount numeric, ledger_debit numeric, needs_ledger_repost boolean, message text)
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

  -- Role must be held in the caller's business, not in any restaurant (helper includes superadmin).
  IF NOT public.has_role_in_tenant(v_tenant, ARRAY['owner','manager','accountant']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants can run the bulk reconcile and fix';
  END IF;

  IF p_invoice_ids IS NULL OR array_length(p_invoice_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOR v_inv IN
    SELECT pi.id, pi.invoice_number, pi.total_amount, pi.tax_amount
    FROM public.purchase_invoices pi
    WHERE pi.id = ANY(p_invoice_ids)
      -- invoices of the caller's business (this compared a restaurant id with the business id, so it
      -- only matched where a restaurant shares its business's id)
      AND pi.restaurant_id IN (SELECT r.id FROM public.restaurants r WHERE r.tenant_id = v_tenant)
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
        v_removed - (SELECT COUNT(DISTINCT (COALESCE(x.description,''), COALESCE(x.quantity,0),
                                            COALESCE(x.unit_price,0), ROUND(COALESCE(x.total_price,0),2)))
                     FROM public.invoice_items x WHERE x.invoice_id = v_inv.id), 0);  -- qualified: invoice_id is also an output column
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

-- remap_expenses_to_supplier_ap_head
CREATE OR REPLACE FUNCTION public.remap_expenses_to_supplier_ap_head(p_supplier_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_actor uuid := auth.uid();
  v_rec RECORD;
  v_leg RECORD;
  v_supplier_ap uuid;
  v_batch_id uuid;
  v_amount numeric;
  v_moved int := 0;
  v_total numeric := 0;
  v_skipped int := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_actor;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant not resolved for current user' USING ERRCODE = '42501';
  END IF;
  -- can_post_journal_entries takes a business id; it was given the user id and refused everyone
  -- except superadmins.
  IF NOT public.can_post_journal_entries(v_tenant) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants can remap supplier payables' USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    SELECT e.id, e.tenant_id, e.branch_id, e.supplier_id, e.description, e.expense_date
    FROM public.expenses e
    WHERE e.tenant_id = v_tenant
      AND e.deleted_at IS NULL
      AND e.supplier_id IS NOT NULL
      AND COALESCE(e.ledger_posted,false) = true
      AND COALESCE(e.status,'unpaid') <> 'paid'
      AND (p_supplier_id IS NULL OR e.supplier_id = p_supplier_id)
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
  LOOP
    v_supplier_ap := public.resolve_supplier_ap_account(v_rec.tenant_id, v_rec.supplier_id);
    IF v_supplier_ap IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    FOR v_leg IN
      SELECT t.account_id,
             round(SUM(COALESCE(t.credit,0) - COALESCE(t.debit,0)), 2) AS net
      FROM public.account_transactions t
      JOIN public.chart_of_accounts c ON c.id = t.account_id
      WHERE t.tenant_id = v_rec.tenant_id
        AND t.reference_type = 'expense'
        AND t.reference_id = v_rec.id
        AND COALESCE(t.is_voided,false) = false
        AND t.account_id <> v_supplier_ap
        AND c.account_type = 'liability'
        AND c.account_code LIKE '2000%'
      GROUP BY t.account_id
      HAVING round(SUM(COALESCE(t.credit,0) - COALESCE(t.debit,0)), 2) > 0.005
    LOOP
      v_amount := v_leg.net;

      INSERT INTO public.journal_entry_batches (
        tenant_id, branch_id, batch_date, description, reference_number, entry_type, created_by,
        is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
      ) VALUES (
        v_rec.tenant_id, v_rec.branch_id, COALESCE(v_rec.expense_date, CURRENT_DATE),
        'Payable reclassified to supplier head: ' || COALESCE(v_rec.description, v_rec.id::text),
        'APREMAP-' || v_rec.id::text || '-' || substr(v_leg.account_id::text, 1, 8),
        'adjustment', v_actor,
        true, now(), v_actor, 'expense', 'approved', v_actor, now()
      ) RETURNING id INTO v_batch_id;

      INSERT INTO public.account_transactions (
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES
        (v_rec.tenant_id, v_leg.account_id, COALESCE(v_rec.expense_date, CURRENT_DATE), v_amount, NULL,
         COALESCE(v_rec.description,'Expense') || ' — moved off shared payable control',
         'expense', v_rec.id, v_actor, v_rec.branch_id, v_batch_id),
        (v_rec.tenant_id, v_supplier_ap, COALESCE(v_rec.expense_date, CURRENT_DATE), NULL, v_amount,
         COALESCE(v_rec.description,'Expense') || ' — payable on supplier head',
         'expense', v_rec.id, v_actor, v_rec.branch_id, v_batch_id);

      UPDATE public.chart_of_accounts SET balance = balance + v_amount, updated_at = now() WHERE id = v_leg.account_id;
      UPDATE public.chart_of_accounts SET balance = balance - v_amount, updated_at = now() WHERE id = v_supplier_ap;

      v_moved := v_moved + 1;
      v_total := v_total + v_amount;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'outcome', 'success',
    'entries_moved', v_moved,
    'amount_moved', round(v_total, 2),
    'suppliers_without_head', v_skipped
  );
END;
$function$;

-- request_terminal_state_refresh
CREATE OR REPLACE FUNCTION public.request_terminal_state_refresh(_restaurant_id uuid, _branch_id uuid DEFAULT NULL::uuid, _terminal_uid text DEFAULT NULL::text)
 RETURNS TABLE(branch_id uuid, menu_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- user_tenant_roles has no restaurant_id column (every call failed); check the restaurant role.
  IF NOT (
    public.has_role(v_uid, _restaurant_id, 'owner'::app_role)
    OR public.has_role(v_uid, _restaurant_id, 'manager'::app_role)
    OR public.is_superadmin(v_uid)
  ) THEN
    RAISE EXCEPTION 'Only owners or managers can refresh terminal state';
  END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT b.id AS bid
    FROM public.branches b
    WHERE b.restaurant_id = _restaurant_id
      AND (_branch_id IS NULL OR b.id = _branch_id)
  ), bumped AS (
    INSERT INTO public.pos_entity_versions AS pev
      (restaurant_id, entity_type, entity_id, version, updated_at)
    SELECT _restaurant_id, 'menu_prices', t.bid::text, 1, now()
    FROM targets t
    ON CONFLICT (restaurant_id, entity_type, entity_id)
    DO UPDATE SET version = pev.version + 1, updated_at = now()
    RETURNING (pev.entity_id)::uuid AS bid, pev.version
  )
  SELECT bumped.bid, bumped.version::integer FROM bumped;  -- version is bigint

  -- audit_logs columns are tenant_id / entity_type / entity_id / new_data.
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, new_data)
  VALUES (
    public.get_restaurant_tenant_id(_restaurant_id),
    v_uid,
    'terminal_state_refresh',
    'pos_terminals',
    NULL,
    jsonb_build_object(
      'branch_id', _branch_id,
      'terminal_uid', _terminal_uid,
      'requested_at', now()
    )
  );
END;
$function$;
