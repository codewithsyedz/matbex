
CREATE TABLE IF NOT EXISTS public.expense_posting_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  branch_id uuid,
  action text NOT NULL CHECK (action IN ('post','reconcile','skip','void')),
  outcome text NOT NULL CHECK (outcome IN ('success','failed','blocked','needs_manual_review')),
  reason_code text NOT NULL,
  reason_detail text,
  batch_id uuid,
  transaction_ids uuid[] DEFAULT '{}',
  dr_total numeric,
  cr_total numeric,
  trigger_source text NOT NULL CHECK (trigger_source IN ('manual','bulk','auto_trigger','reconcile_job')),
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eposting_audit_tenant_created ON public.expense_posting_audit (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eposting_audit_expense ON public.expense_posting_audit (expense_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eposting_audit_branch ON public.expense_posting_audit (branch_id);

GRANT SELECT ON public.expense_posting_audit TO authenticated;
GRANT ALL ON public.expense_posting_audit TO service_role;

ALTER TABLE public.expense_posting_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Posting audit: tenant managers/accountants read"
  ON public.expense_posting_audit
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('owner'::app_role,'manager'::app_role,'accountant'::app_role)
    )
  );

CREATE POLICY "Posting audit: service role write"
  ON public.expense_posting_audit
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.classify_unposted_expense(p_expense_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_exp RECORD; v_acct RECORD; v_locked boolean; v_vis_count int; v_branch_match int;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','reason_code','not_found','reason_detail','Expense not found');
  END IF;
  IF v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','blocked','reason_code','deleted','reason_detail','Expense was soft-deleted');
  END IF;
  IF COALESCE(v_exp.ledger_posted, false) THEN
    RETURN jsonb_build_object('status','posted','reason_code','already_posted','reason_detail','Already posted to ledger');
  END IF;
  IF COALESCE(v_exp.approval_status,'pending') <> 'approved' THEN
    RETURN jsonb_build_object('status','blocked','reason_code','pending_approval',
      'reason_detail','Expense is ' || COALESCE(v_exp.approval_status,'pending') || ' — approve it first',
      'suggested_action','approve_expense');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_period_locks
    WHERE tenant_id = v_exp.tenant_id AND COALESCE(is_locked, true) = true
      AND v_exp.expense_date BETWEEN period_start AND period_end
  ) INTO v_locked;
  IF v_locked THEN
    RETURN jsonb_build_object('status','blocked','reason_code','period_locked',
      'reason_detail','Fiscal period covering ' || v_exp.expense_date || ' is locked',
      'suggested_action','unlock_period');
  END IF;

  IF v_exp.account_id IS NULL THEN
    RETURN jsonb_build_object('status','blocked','reason_code','missing_account',
      'reason_detail','No Chart of Accounts mapping on this expense',
      'suggested_action','assign_account');
  END IF;

  SELECT id, account_code, account_name, account_type::text AS account_type INTO v_acct
  FROM public.chart_of_accounts WHERE id = v_exp.account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','blocked','reason_code','missing_account',
      'reason_detail','Mapped account no longer exists','suggested_action','assign_account');
  END IF;

  IF v_acct.account_type = 'cogs' THEN
    RETURN jsonb_build_object('status','blocked','reason_code','cogs_routed',
      'reason_detail','Account ' || v_acct.account_code || ' ' || v_acct.account_name ||
                     ' is COGS — record via Inventory Purchase, not direct expense posting',
      'suggested_action','open_inventory_purchase','target_account_id', v_acct.id);
  END IF;

  IF v_exp.branch_id IS NOT NULL THEN
    SELECT count(*) INTO v_vis_count FROM public.account_branch_visibility WHERE account_id = v_acct.id;
    IF v_vis_count > 0 THEN
      SELECT count(*) INTO v_branch_match FROM public.account_branch_visibility
        WHERE account_id = v_acct.id AND branch_id = v_exp.branch_id;
      IF v_branch_match = 0 THEN
        RETURN jsonb_build_object('status','blocked','reason_code','missing_branch_visibility',
          'reason_detail','Account ' || v_acct.account_code || ' is hidden for the expense branch',
          'suggested_action','update_visibility','target_account_id', v_acct.id);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('status','ready','reason_code','ready',
    'reason_detail','Ready to post','target_account_id', v_acct.id);
END; $$;

GRANT EXECUTE ON FUNCTION public.classify_unposted_expense(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_post_expenses(
  p_tenant_id uuid, p_branch_id uuid DEFAULT NULL, p_expense_ids uuid[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row RECORD; v_classify jsonb; v_tx_id uuid; v_batch_id uuid;
  v_actor uuid := auth.uid();
  v_attempted int := 0; v_posted int := 0; v_skipped int := 0; v_failed int := 0;
  v_details jsonb := '[]'::jsonb; v_err text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_actor
      AND role IN ('owner'::app_role,'manager'::app_role,'accountant'::app_role)
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Insufficient privileges to bulk-post expenses';
  END IF;
  IF public.get_user_tenant_id(v_actor) <> p_tenant_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Cannot post for another tenant';
  END IF;

  FOR v_row IN
    SELECT e.id, e.branch_id, e.account_id FROM public.expenses e
    WHERE e.tenant_id = p_tenant_id
      AND COALESCE(e.ledger_posted, false) = false
      AND e.deleted_at IS NULL
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
      AND (p_expense_ids IS NULL OR e.id = ANY(p_expense_ids))
    ORDER BY e.expense_date, e.created_at
  LOOP
    v_attempted := v_attempted + 1;
    v_classify := public.classify_unposted_expense(v_row.id);

    IF (v_classify->>'status') <> 'ready' THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, trigger_source, triggered_by
      ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'skip', 'blocked',
        v_classify->>'reason_code', v_classify->>'reason_detail', 'bulk', v_actor);
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'expense_id', v_row.id, 'outcome','blocked',
        'reason_code', v_classify->>'reason_code',
        'reason_detail', v_classify->>'reason_detail'));
      CONTINUE;
    END IF;

    BEGIN
      v_tx_id := public.post_expense_to_ledger(v_row.id, (v_classify->>'target_account_id')::uuid);
      SELECT batch_id INTO v_batch_id FROM public.account_transactions WHERE id = v_tx_id;
      v_posted := v_posted + 1;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, batch_id, transaction_ids,
        dr_total, cr_total, trigger_source, triggered_by
      )
      SELECT p_tenant_id, v_row.id, v_row.branch_id, 'post', 'success',
             'posted','Posted via bulk action', v_batch_id, array_agg(t.id),
             COALESCE(sum(t.debit),0), COALESCE(sum(t.credit),0),
             'bulk', v_actor
      FROM public.account_transactions t WHERE t.batch_id = v_batch_id;
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'expense_id', v_row.id, 'outcome','posted', 'batch_id', v_batch_id));
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_err := SQLERRM;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, trigger_source, triggered_by
      ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'post', 'failed',
        'validation_failed', v_err, 'bulk', v_actor);
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'expense_id', v_row.id, 'outcome','failed', 'reason_detail', v_err));
    END;
  END LOOP;

  RETURN jsonb_build_object('attempted', v_attempted, 'posted', v_posted,
    'skipped', v_skipped, 'failed', v_failed, 'details', v_details);
END; $$;

GRANT EXECUTE ON FUNCTION public.bulk_post_expenses(uuid, uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_reconcile_imbalanced_expenses(
  p_tenant_id uuid, p_branch_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row RECORD; v_dr numeric; v_cr numeric; v_diff numeric;
  v_credit_code text; v_credit_acct uuid;
  v_actor uuid := auth.uid(); v_batch_id uuid;
  v_fixed int := 0; v_manual int := 0; v_manual_review jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_actor
      AND role IN ('owner'::app_role,'manager'::app_role,'accountant'::app_role)
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Insufficient privileges';
  END IF;

  FOR v_row IN
    SELECT e.id, e.tenant_id, e.branch_id, e.amount, e.expense_date, e.status, e.description
    FROM public.expenses e
    WHERE e.tenant_id = p_tenant_id
      AND COALESCE(e.ledger_posted, false) = true
      AND e.deleted_at IS NULL
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
  LOOP
    SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO v_dr, v_cr
    FROM public.account_transactions
    WHERE reference_type='expense' AND reference_id = v_row.id
      AND COALESCE(is_voided,false) = false;

    v_diff := round(v_dr - v_cr, 2);
    IF abs(v_diff) <= 0.005 THEN CONTINUE; END IF;

    SELECT batch_id INTO v_batch_id FROM public.account_transactions
    WHERE reference_type='expense' AND reference_id = v_row.id
    ORDER BY created_at ASC LIMIT 1;

    IF v_diff > 0 AND abs(v_diff - v_row.amount) <= 0.01 THEN
      v_credit_code := CASE WHEN COALESCE(v_row.status,'unpaid') = 'paid' THEN '1000' ELSE '2000' END;
      SELECT id INTO v_credit_acct FROM public.chart_of_accounts
        WHERE tenant_id = v_row.tenant_id AND account_code = v_credit_code LIMIT 1;

      IF v_credit_acct IS NULL THEN
        v_manual := v_manual + 1;
        v_manual_review := v_manual_review || jsonb_build_array(jsonb_build_object(
          'expense_id', v_row.id, 'diff', v_diff, 'fields', ARRAY['credit_account'],
          'reason','Counter account ' || v_credit_code || ' missing in CoA'));
        INSERT INTO public.expense_posting_audit (
          tenant_id, expense_id, branch_id, action, outcome,
          reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
        ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'reconcile','needs_manual_review',
          'missing_account','Counter account '||v_credit_code||' missing', v_dr, v_cr, 'reconcile_job', v_actor);
        CONTINUE;
      END IF;

      INSERT INTO public.account_transactions (
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES (v_row.tenant_id, v_credit_acct, v_row.expense_date, NULL, v_diff,
        COALESCE(v_row.description,'Expense') || ' — auto-reconcile credit leg',
        'expense', v_row.id, v_actor, v_row.branch_id, v_batch_id);
      v_fixed := v_fixed + 1;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'reconcile','success',
        'auto_reconciled','Inserted missing credit leg of '||v_diff,
        v_batch_id, v_dr, v_cr + v_diff, 'reconcile_job', v_actor);
    ELSE
      v_manual := v_manual + 1;
      v_manual_review := v_manual_review || jsonb_build_array(jsonb_build_object(
        'expense_id', v_row.id, 'dr_total', v_dr, 'cr_total', v_cr, 'diff', v_diff,
        'fields', ARRAY['debit','credit'],
        'reason','Imbalance does not match a known auto-fix pattern'));
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (p_tenant_id, v_row.id, v_row.branch_id, 'reconcile','needs_manual_review',
        'ambiguous_imbalance','Diff '||v_diff||' does not match a single missing-leg pattern',
        v_dr, v_cr, 'reconcile_job', v_actor);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('fixed', v_fixed, 'manual_review_count', v_manual, 'manual_review', v_manual_review);
END; $$;

GRANT EXECUTE ON FUNCTION public.auto_reconcile_imbalanced_expenses(uuid, uuid) TO authenticated;
