-- 1. Role guard helper: who may reverse a posted AP settlement
CREATE OR REPLACE FUNCTION public.can_reverse_ap_settlement(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN ('owner'::public.app_role, 'accountant'::public.app_role, 'superadmin'::public.app_role)
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_reverse_ap_settlement(uuid) TO authenticated;

-- 2. Enforce the guard inside the settlement/reversal engine
CREATE OR REPLACE FUNCTION public.reclassify_expense_credit_account(p_expense_id uuid, p_reason text DEFAULT 'payment status change')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exp RECORD;
  v_ap_parent uuid;
  v_cash_parent uuid;
  v_ap_account uuid;
  v_cash_account uuid;
  v_ap_net numeric;
  v_amount numeric;
  v_actor uuid;
  v_batch_id uuid;
  v_is_paid boolean;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','not_found','error','Expense not found');
  END IF;

  IF COALESCE(v_exp.ledger_posted,false) = false THEN
    RETURN jsonb_build_object('outcome','skipped','reason_code','not_posted','reason_detail','Expense is not posted to the ledger yet');
  END IF;

  v_is_paid := COALESCE(v_exp.status,'unpaid') = 'paid';

  SELECT id INTO v_ap_parent FROM public.chart_of_accounts
   WHERE tenant_id = v_exp.tenant_id AND account_code = '2000' AND is_active = true LIMIT 1;
  SELECT id INTO v_cash_parent FROM public.chart_of_accounts
   WHERE tenant_id = v_exp.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;

  IF v_ap_parent IS NULL OR v_cash_parent IS NULL THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','missing_account','error','Accounts 1000 / 2000 not found');
  END IF;

  v_ap_account := public.resolve_branch_account(v_ap_parent, v_exp.branch_id);
  v_cash_account := public.resolve_branch_account(v_cash_parent, v_exp.branch_id);

  SELECT COALESCE(sum(COALESCE(credit,0) - COALESCE(debit,0)), 0)
    INTO v_ap_net
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND account_id IN (v_ap_account, v_ap_parent)
    AND COALESCE(is_voided,false) = false;

  v_actor := COALESCE(auth.uid(), v_exp.approved_by, v_exp.created_by);

  IF v_is_paid THEN
    IF v_ap_net <= 0.005 THEN
      RETURN jsonb_build_object('outcome','unchanged','reason_code','no_open_payable');
    END IF;
    v_amount := round(v_ap_net, 2);

    INSERT INTO public.journal_entry_batches (
      tenant_id, branch_id, batch_date, description, reference_number, entry_type, created_by,
      is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
    ) VALUES (
      v_exp.tenant_id, v_exp.branch_id, COALESCE(v_exp.payment_date, CURRENT_DATE),
      'Supplier payment: ' || COALESCE(v_exp.description, v_exp.id::text),
      'EXPPAY-' || v_exp.id::text, 'payment', v_actor,
      true, now(), v_actor, 'expense', 'approved', v_actor, now()
    ) RETURNING id INTO v_batch_id;

    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, branch_id, batch_id
    ) VALUES
      (v_exp.tenant_id, v_ap_account, COALESCE(v_exp.payment_date, CURRENT_DATE), v_amount, NULL,
       COALESCE(v_exp.description,'Expense') || ' — payable settled', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id),
      (v_exp.tenant_id, v_cash_account, COALESCE(v_exp.payment_date, CURRENT_DATE), NULL, v_amount,
       COALESCE(v_exp.description,'Expense') || ' — paid (Cash)', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id);

    UPDATE public.chart_of_accounts SET balance = balance + v_amount, updated_at = now() WHERE id = v_ap_account;
    UPDATE public.chart_of_accounts SET balance = balance - v_amount, updated_at = now() WHERE id = v_cash_account;

    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'payable_settled',
        'DR 2000 Accounts Payable / CR 1000 Cash on Hand — ' || p_reason,
        v_batch_id, v_amount, v_amount,
        CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END, v_actor
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object('outcome','success','reason_code','payable_settled','amount',v_amount,'batch_id',v_batch_id);
  END IF;

  -- Reverted to unpaid: restore the payable if a settlement exists
  IF v_ap_net > 0.005 THEN
    RETURN jsonb_build_object('outcome','unchanged','reason_code','payable_already_open');
  END IF;

  v_amount := round(abs(v_ap_net), 2);
  IF v_amount <= 0.005 THEN
    RETURN jsonb_build_object('outcome','unchanged','reason_code','nothing_to_reverse');
  END IF;

  -- ROLE GUARD: only owners / accountants / platform admins may reverse a
  -- posted settlement. Background jobs (auth.uid() IS NULL) stay allowed.
  IF auth.uid() IS NOT NULL AND NOT public.can_reverse_ap_settlement(auth.uid()) THEN
    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'failed', 'reversal_forbidden',
        'Reversal blocked — user is not an owner or accountant',
        0, 0, 'manual', auth.uid()
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE EXCEPTION 'Only owners or accountants can reverse a posted AP settlement'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number, entry_type, created_by,
    is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
  ) VALUES (
    v_exp.tenant_id, v_exp.branch_id, CURRENT_DATE,
    'Supplier payment reversal: ' || COALESCE(v_exp.description, v_exp.id::text),
    'EXPPAYREV-' || v_exp.id::text, 'payment', v_actor,
    true, now(), v_actor, 'expense', 'approved', v_actor, now()
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES
    (v_exp.tenant_id, v_cash_account, CURRENT_DATE, v_amount, NULL,
     COALESCE(v_exp.description,'Expense') || ' — payment reversed (Cash back)', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id),
    (v_exp.tenant_id, v_ap_account, CURRENT_DATE, NULL, v_amount,
     COALESCE(v_exp.description,'Expense') || ' — payable restored (AP)', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id);

  UPDATE public.chart_of_accounts SET balance = balance + v_amount, updated_at = now() WHERE id = v_cash_account;
  UPDATE public.chart_of_accounts SET balance = balance - v_amount, updated_at = now() WHERE id = v_ap_account;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
      batch_id, dr_total, cr_total, trigger_source, triggered_by
    ) VALUES (
      v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'payment_reversed',
      'DR 1000 Cash on Hand / CR 2000 Accounts Payable — ' || p_reason,
      v_batch_id, v_amount, v_amount,
      CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END, v_actor
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('outcome','success','reason_code','payment_reversed','amount',v_amount,'batch_id',v_batch_id);
END;
$function$;

-- 3. Explicit, reason-carrying reversal entry point used by the approval prompt
CREATE OR REPLACE FUNCTION public.request_ap_settlement_reversal(p_expense_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp RECORD;
  v_result jsonb;
BEGIN
  IF NOT public.can_reverse_ap_settlement(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners or accountants can reverse a posted AP settlement'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'A reversal reason of at least 5 characters is required';
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF v_exp.tenant_id IS DISTINCT FROM public.get_user_tenant_id(auth.uid()) THEN
    RAISE EXCEPTION 'Expense belongs to another tenant' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_exp.status,'unpaid') <> 'paid' THEN
    RAISE EXCEPTION 'This expense is not marked as paid — there is no settlement to reverse';
  END IF;

  UPDATE public.expenses
     SET status = 'unpaid',
         paid_amount = 0,
         updated_at = now()
   WHERE id = p_expense_id;

  SELECT public.reclassify_expense_credit_account(p_expense_id, 'approved reversal: ' || btrim(p_reason))
    INTO v_result;

  BEGIN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, target_type, target_id, details)
    VALUES (
      v_exp.tenant_id, auth.uid(), 'AP_SETTLEMENT_REVERSAL', 'other', p_expense_id,
      jsonb_build_object('reason', btrim(p_reason), 'result', v_result, 'branch_id', v_exp.branch_id)
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN COALESCE(v_result, jsonb_build_object('outcome','unchanged'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_ap_settlement_reversal(uuid, text) TO authenticated;