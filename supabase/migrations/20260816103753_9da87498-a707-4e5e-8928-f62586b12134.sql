CREATE OR REPLACE FUNCTION public.remap_expenses_to_supplier_ap_head(
  p_supplier_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
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
  IF NOT public.can_post_journal_entries(v_actor) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants can remap supplier payables' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_actor;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant not resolved for current user' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.remap_expenses_to_supplier_ap_head(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remap_expenses_to_supplier_ap_head(uuid, uuid) TO authenticated;