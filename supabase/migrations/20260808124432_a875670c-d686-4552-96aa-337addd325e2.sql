CREATE OR REPLACE FUNCTION public.reclassify_expense_credit_account(p_expense_id uuid, p_reason text DEFAULT 'status_change'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_exp RECORD;
  v_ap_parent uuid;
  v_ap_account uuid;
  v_cash_account uuid;
  v_ap_net numeric;
  v_amount numeric;
  v_actor uuid;
  v_batch_id uuid;
  v_is_paid boolean;
  v_pay_date date;
  v_acct_label text;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','not_found','error','Expense not found');
  END IF;

  IF COALESCE(v_exp.ledger_posted,false) = false THEN
    RETURN jsonb_build_object('outcome','skipped','reason_code','not_posted','reason_detail','Expense is not posted to the ledger yet');
  END IF;

  v_pay_date := GREATEST(COALESCE(v_exp.expense_date, CURRENT_DATE), CURRENT_DATE);
  v_is_paid := COALESCE(v_exp.status,'unpaid') = 'paid';

  SELECT id INTO v_ap_parent FROM public.chart_of_accounts
   WHERE tenant_id = v_exp.tenant_id AND account_code = '2000' AND is_active = true LIMIT 1;

  v_cash_account := public.resolve_expense_funding_account(p_expense_id);

  IF v_ap_parent IS NULL OR v_cash_account IS NULL THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','missing_account','error','Payable or funding account not found');
  END IF;

  -- Guard: only real cash/bank accounts (or an owner/partner capital account)
  -- may be credited when settling a payable.
  IF NOT public.assert_expense_funding_account_valid(p_expense_id, v_cash_account) THEN
    SELECT COALESCE(account_code || ' ' || account_name, v_cash_account::text)
      INTO v_acct_label FROM public.chart_of_accounts WHERE id = v_cash_account;

    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'failed', 'invalid_funding_account',
        'Settlement blocked — paying account ' || COALESCE(v_acct_label,'(unknown)') ||
        ' is not a cash or bank account (1000-1099).',
        0, 0, CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END, auth.uid()
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object(
      'outcome','failed',
      'reason_code','invalid_funding_account',
      'error','Paying account ' || COALESCE(v_acct_label,'(unknown)') ||
              ' is not a cash or bank account. Choose a 1000-1099 cash/bank account before marking this bill paid.'
    );
  END IF;

  v_ap_account := public.resolve_branch_account(v_ap_parent, v_exp.branch_id);

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
      v_exp.tenant_id, v_exp.branch_id, v_pay_date,
      'Supplier payment: ' || COALESCE(v_exp.description, v_exp.id::text),
      'EXPPAY-' || v_exp.id::text, 'payment', v_actor,
      true, now(), v_actor, 'expense', 'approved', v_actor, now()
    ) RETURNING id INTO v_batch_id;

    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, branch_id, batch_id
    ) VALUES
      (v_exp.tenant_id, v_ap_account, v_pay_date, v_amount, NULL,
       COALESCE(v_exp.description,'Expense') || ' — payable settled', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id),
      (v_exp.tenant_id, v_cash_account, v_pay_date, NULL, v_amount,
       COALESCE(v_exp.description,'Expense') || ' — paid from selected account', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id);

    UPDATE public.chart_of_accounts SET balance = balance + v_amount, updated_at = now() WHERE id = v_ap_account;
    UPDATE public.chart_of_accounts SET balance = balance - v_amount, updated_at = now() WHERE id = v_cash_account;

    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'payable_settled',
        'DR 2000 Accounts Payable / CR selected funding account — ' || p_reason,
        v_batch_id, v_amount, v_amount,
        CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END, v_actor
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN jsonb_build_object('outcome','success','reason_code','payable_settled','amount',v_amount,'batch_id',v_batch_id);
  END IF;

  IF v_ap_net > 0.005 THEN
    RETURN jsonb_build_object('outcome','unchanged','reason_code','payable_already_open');
  END IF;

  v_amount := round(abs(v_ap_net), 2);
  IF v_amount <= 0.005 THEN
    RETURN jsonb_build_object('outcome','unchanged','reason_code','nothing_to_reverse');
  END IF;

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
     COALESCE(v_exp.description,'Expense') || ' — payment reversed', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id),
    (v_exp.tenant_id, v_ap_account, CURRENT_DATE, NULL, v_amount,
     COALESCE(v_exp.description,'Expense') || ' — payable reinstated', 'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id);

  UPDATE public.chart_of_accounts SET balance = balance + v_amount, updated_at = now() WHERE id = v_cash_account;
  UPDATE public.chart_of_accounts SET balance = balance - v_amount, updated_at = now() WHERE id = v_ap_account;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
      batch_id, dr_total, cr_total, trigger_source, triggered_by
    ) VALUES (
      v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'settlement_reversed',
      'DR funding account / CR 2000 Accounts Payable — ' || p_reason,
      v_batch_id, v_amount, v_amount,
      CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END, v_actor
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('outcome','success','reason_code','settlement_reversed','amount',v_amount,'batch_id',v_batch_id);
END;
$function$;