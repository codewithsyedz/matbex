
-- Single-row post: posts one expense, returns outcome + error so the client can
-- iterate and show per-entry progress. Role-gated server-side.
CREATE OR REPLACE FUNCTION public.post_single_expense(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exp RECORD;
  v_classify jsonb;
  v_tx_id uuid;
  v_batch_id uuid;
  v_dr numeric;
  v_cr numeric;
  v_err text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','unauthenticated','error','Not authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_actor
      AND role IN ('owner'::app_role,'manager'::app_role,'accountant'::app_role)
  ) THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','forbidden','error','Insufficient privileges');
  END IF;

  SELECT id, tenant_id, branch_id, ledger_posted, deleted_at
    INTO v_exp
  FROM public.expenses
  WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','not_found','error','Expense not found');
  END IF;
  IF v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','blocked','reason_code','deleted','error','Expense is deleted');
  END IF;
  IF public.get_user_tenant_id(v_actor) <> v_exp.tenant_id THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','forbidden','error','Cannot post for another tenant');
  END IF;

  v_classify := public.classify_unposted_expense(p_expense_id);
  IF (v_classify->>'status') <> 'ready' THEN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, trigger_source, triggered_by
    ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'skip', 'blocked',
      v_classify->>'reason_code', v_classify->>'reason_detail', 'retry', v_actor);
    RETURN jsonb_build_object(
      'outcome','blocked',
      'reason_code', v_classify->>'reason_code',
      'reason_detail', v_classify->>'reason_detail',
      'error', v_classify->>'reason_detail');
  END IF;

  BEGIN
    v_tx_id := public.post_expense_to_ledger(p_expense_id, (v_classify->>'target_account_id')::uuid);
    SELECT batch_id INTO v_batch_id FROM public.account_transactions WHERE id = v_tx_id;
    SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO v_dr, v_cr
    FROM public.account_transactions WHERE batch_id = v_batch_id;
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, batch_id, transaction_ids,
      dr_total, cr_total, trigger_source, triggered_by
    )
    SELECT v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'post','success',
           'posted','Posted via single-row retry', v_batch_id, array_agg(t.id),
           v_dr, v_cr, 'retry', v_actor
    FROM public.account_transactions t WHERE t.batch_id = v_batch_id;
    RETURN jsonb_build_object('outcome','posted','batch_id', v_batch_id,
                              'dr_total', v_dr, 'cr_total', v_cr);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, trigger_source, triggered_by
    ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'post','failed',
      'validation_failed', v_err, 'retry', v_actor);
    RETURN jsonb_build_object('outcome','failed','reason_code','validation_failed','error', v_err);
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_single_expense(uuid) TO authenticated;

-- Single-row auto-reconcile for live progress
CREATE OR REPLACE FUNCTION public.auto_reconcile_single_expense(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exp RECORD;
  v_dr numeric; v_cr numeric; v_diff numeric;
  v_credit_code text; v_credit_acct uuid;
  v_batch_id uuid; v_err text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('outcome','failed','error','Not authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_actor
      AND role IN ('owner'::app_role,'manager'::app_role,'accountant'::app_role)
  ) THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','forbidden','error','Insufficient privileges');
  END IF;

  SELECT id, tenant_id, branch_id, amount, expense_date, status, description
    INTO v_exp
  FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','error','Expense not found');
  END IF;
  IF public.get_user_tenant_id(v_actor) <> v_exp.tenant_id THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','forbidden','error','Cannot reconcile for another tenant');
  END IF;

  SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO v_dr, v_cr
  FROM public.account_transactions
  WHERE reference_type='expense' AND reference_id = p_expense_id
    AND COALESCE(is_voided,false) = false;
  v_diff := round(v_dr - v_cr, 2);

  IF abs(v_diff) <= 0.005 THEN
    RETURN jsonb_build_object('outcome','already_balanced','dr_total',v_dr,'cr_total',v_cr);
  END IF;

  SELECT batch_id INTO v_batch_id FROM public.account_transactions
  WHERE reference_type='expense' AND reference_id = p_expense_id
  ORDER BY created_at ASC LIMIT 1;

  IF v_diff > 0 AND abs(v_diff - v_exp.amount) <= 0.01 THEN
    v_credit_code := CASE WHEN COALESCE(v_exp.status,'unpaid') = 'paid' THEN '1000' ELSE '2000' END;
    SELECT id INTO v_credit_acct FROM public.chart_of_accounts
      WHERE tenant_id = v_exp.tenant_id AND account_code = v_credit_code LIMIT 1;

    IF v_credit_acct IS NULL THEN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','needs_manual_review',
        'missing_account','Counter account '||v_credit_code||' missing in CoA',
        v_dr, v_cr, 'reconcile_single', v_actor);
      RETURN jsonb_build_object('outcome','needs_manual_review',
        'reason_code','missing_account','error','Counter account '||v_credit_code||' missing');
    END IF;

    BEGIN
      INSERT INTO public.account_transactions (
        tenant_id, account_id, transaction_date, debit, credit,
        description, reference_type, reference_id, created_by, branch_id, batch_id
      ) VALUES (v_exp.tenant_id, v_credit_acct, v_exp.expense_date, NULL, v_diff,
        COALESCE(v_exp.description,'Expense') || ' — auto-reconcile credit leg',
        'expense', v_exp.id, v_actor, v_exp.branch_id, v_batch_id);
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','success',
        'auto_reconciled','Inserted missing credit leg of '||v_diff,
        v_batch_id, v_dr, v_cr + v_diff, 'reconcile_single', v_actor);
      RETURN jsonb_build_object('outcome','fixed','diff',v_diff,'batch_id',v_batch_id);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome,
        reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','failed',
        'validation_failed', v_err, v_dr, v_cr, 'reconcile_single', v_actor);
      RETURN jsonb_build_object('outcome','failed','error', v_err);
    END;
  END IF;

  INSERT INTO public.expense_posting_audit (
    tenant_id, expense_id, branch_id, action, outcome,
    reason_code, reason_detail, dr_total, cr_total, trigger_source, triggered_by
  ) VALUES (v_exp.tenant_id, v_exp.id, v_exp.branch_id, 'reconcile','needs_manual_review',
    'ambiguous_imbalance','Diff '||v_diff||' does not match a single missing-leg pattern',
    v_dr, v_cr, 'reconcile_single', v_actor);
  RETURN jsonb_build_object('outcome','needs_manual_review',
    'reason_code','ambiguous_imbalance','diff', v_diff,
    'error','Imbalance does not match a known auto-fix pattern');
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_reconcile_single_expense(uuid) TO authenticated;

-- explain_imbalance: returns batch + legs + suggested fix for the drawer
CREATE OR REPLACE FUNCTION public.explain_imbalance(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF public.get_user_tenant_id(v_actor) <> v_exp.tenant_id THEN
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

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'batch_id', jb.id, 'batch_number', jb.batch_number,
    'description', jb.description, 'entry_date', jb.entry_date,
    'status', jb.status, 'total_amount', jb.total_amount
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
$$;

GRANT EXECUTE ON FUNCTION public.explain_imbalance(uuid) TO authenticated;
