CREATE OR REPLACE FUNCTION public.post_expense_to_ledger(p_expense_id uuid, p_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expense RECORD;
  v_debit_tx_id uuid;
  v_account_type text;
  v_debit_account_id uuid;
  v_credit_account_id uuid;
  v_credit_parent_id uuid;
  v_credit_code text;
  v_batch_id uuid;
  v_actor_id uuid;
  v_journal_type text;
  v_dr numeric;
  v_cr numeric;
BEGIN
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_expense.approval_status != 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to ledger';
  END IF;
  IF COALESCE(v_expense.ledger_posted, false) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense has already been posted to ledger';
  END IF;

  SELECT account_type::text INTO v_account_type
  FROM public.chart_of_accounts WHERE id = p_account_id;

  IF v_account_type = 'cogs' THEN
    v_debit_account_id := public.resolve_inventory_account_for_cogs(v_expense.tenant_id, p_account_id);
    v_journal_type := 'purchase';
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No inventory asset account found for COGS routing';
    END IF;
  ELSE
    v_debit_account_id := p_account_id;
    v_journal_type := 'expense';
  END IF;

  IF v_debit_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense must have a Chart of Accounts mapping before posting to ledger';
  END IF;

  -- Branch-aware debit account (falls back to the parent account)
  v_debit_account_id := public.resolve_branch_account(v_debit_account_id, v_expense.branch_id);

  v_credit_code := CASE WHEN COALESCE(v_expense.status, 'unpaid') = 'paid' THEN '1000' ELSE '2000' END;

  SELECT id INTO v_credit_parent_id
  FROM public.chart_of_accounts
  WHERE tenant_id = v_expense.tenant_id AND account_code = v_credit_code LIMIT 1;
  IF v_credit_parent_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Counter-account % not found in chart of accounts for this tenant', v_credit_code;
  END IF;

  -- Branch-aware counter account (Cash / AP sub-account for the branch)
  v_credit_account_id := public.resolve_branch_account(v_credit_parent_id, v_expense.branch_id);

  v_actor_id := COALESCE(auth.uid(), v_expense.approved_by, v_expense.created_by);

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number, entry_type, created_by,
    is_posted, posted_at, posted_by, journal_type, approval_status, approved_by, approved_at
  ) VALUES (
    v_expense.tenant_id, v_expense.branch_id, v_expense.expense_date,
    CASE WHEN v_journal_type = 'purchase' THEN 'Inventory purchase from expense: ' ELSE 'Expense posting: ' END
      || COALESCE(v_expense.description, v_expense.id::text),
    'EXP-' || v_expense.id::text, v_journal_type, v_actor_id,
    true, now(), v_actor_id, v_journal_type, 'approved', v_actor_id, now()
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_debit_account_id, v_expense.expense_date, v_expense.amount, NULL,
    CASE WHEN v_journal_type = 'purchase'
         THEN COALESCE(v_expense.description, 'Inventory purchase') || ' — inventory purchase'
         ELSE COALESCE(v_expense.description, 'Expense') END,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  ) RETURNING id INTO v_debit_tx_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_credit_account_id, v_expense.expense_date, NULL, v_expense.amount,
    COALESCE(v_expense.description, 'Expense') || ' — ' ||
      CASE WHEN v_credit_code = '1000' THEN 'paid (Cash)' ELSE 'on credit (AP)' END,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  );

  -- Balance assertion: the batch must net to zero
  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
    INTO v_dr, v_cr
  FROM public.account_transactions
  WHERE batch_id = v_batch_id AND COALESCE(is_voided, false) = false;

  IF abs(v_dr - v_cr) > 0.005 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense posting is unbalanced (DR % vs CR %)', v_dr, v_cr;
  END IF;

  UPDATE public.expenses
  SET ledger_posted = true, ledger_transaction_id = v_debit_tx_id, account_id = p_account_id
  WHERE id = p_expense_id;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, batch_id, transaction_ids,
      dr_total, cr_total, trigger_source, triggered_by
    )
    SELECT v_expense.tenant_id, p_expense_id, v_expense.branch_id, 'post', 'success',
           'posted', 'Posted via post_expense_to_ledger using branch-resolved counter-account ' || v_credit_code, v_batch_id,
           array_agg(t.id),
           COALESCE(sum(t.debit),0), COALESCE(sum(t.credit),0),
           CASE WHEN auth.uid() IS NULL THEN 'auto_trigger' ELSE 'manual' END,
           v_actor_id
    FROM public.account_transactions t WHERE t.batch_id = v_batch_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_debit_tx_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reclassify_expense_credit_account(p_expense_id uuid, p_reason text DEFAULT 'payment status change')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exp RECORD;
  v_target_code text;
  v_target_parent_id uuid;
  v_target_account_id uuid;
  v_actor uuid;
  v_batch_id uuid;
  v_credit_amount numeric;
  v_existing_target_credit numeric;
  v_existing_other_credit numeric;
  v_new_tx_id uuid;
  v_voided_ids uuid[] := ARRAY[]::uuid[];
  v_credit RECORD;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'failed', 'reason_code', 'not_found', 'error', 'Expense not found');
  END IF;

  IF COALESCE(v_exp.ledger_posted, false) = false THEN
    RETURN jsonb_build_object('outcome', 'skipped', 'reason_code', 'not_posted', 'reason_detail', 'Expense is not posted to the ledger yet');
  END IF;

  v_target_code := CASE WHEN COALESCE(v_exp.status, 'unpaid') = 'paid' THEN '1000' ELSE '2000' END;

  SELECT id INTO v_target_parent_id
  FROM public.chart_of_accounts
  WHERE tenant_id = v_exp.tenant_id
    AND account_code = v_target_code
    AND is_active = true
  LIMIT 1;

  IF v_target_parent_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'failed', 'reason_code', 'missing_account', 'error', 'Counter account ' || v_target_code || ' not found');
  END IF;

  v_target_account_id := public.resolve_branch_account(v_target_parent_id, v_exp.branch_id);

  SELECT COALESCE(sum(debit), 0)
    INTO v_credit_amount
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND COALESCE(is_voided, false) = false;

  IF v_credit_amount <= 0 THEN
    v_credit_amount := v_exp.amount;
  END IF;

  SELECT COALESCE(sum(CASE WHEN account_id = v_target_account_id THEN credit ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN account_id <> v_target_account_id THEN credit ELSE 0 END), 0)
    INTO v_existing_target_credit, v_existing_other_credit
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND COALESCE(is_voided, false) = false
    AND COALESCE(credit, 0) > 0;

  IF abs(v_existing_target_credit - v_credit_amount) <= 0.005
     AND abs(v_existing_other_credit) <= 0.005 THEN
    RETURN jsonb_build_object('outcome', 'unchanged', 'target_account_code', v_target_code);
  END IF;

  SELECT batch_id INTO v_batch_id
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND batch_id IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1;

  v_actor := COALESCE(auth.uid(), v_exp.approved_by, v_exp.created_by);

  FOR v_credit IN
    SELECT id, account_id, debit, credit
    FROM public.account_transactions
    WHERE reference_type = 'expense'
      AND reference_id = p_expense_id
      AND COALESCE(is_voided, false) = false
      AND COALESCE(credit, 0) > 0
  LOOP
    UPDATE public.account_transactions
    SET is_voided = true,
        voided_at = now(),
        voided_by = v_actor,
        void_reason = 'Reclassified expense counter-account: ' || p_reason
    WHERE id = v_credit.id;

    UPDATE public.chart_of_accounts
    SET balance = balance - COALESCE(v_credit.debit, 0) + COALESCE(v_credit.credit, 0),
        updated_at = now()
    WHERE id = v_credit.account_id;

    v_voided_ids := array_append(v_voided_ids, v_credit.id);
  END LOOP;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_exp.tenant_id, v_target_account_id, v_exp.expense_date, NULL, v_credit_amount,
    COALESCE(v_exp.description, 'Expense') || ' — ' ||
      CASE WHEN v_target_code = '1000' THEN 'paid (Cash)' ELSE 'on credit (AP)' END,
    'expense', p_expense_id, v_actor, v_exp.branch_id, v_batch_id
  ) RETURNING id INTO v_new_tx_id;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome,
      reason_code, reason_detail, batch_id, transaction_ids,
      dr_total, cr_total, trigger_source, triggered_by
    ) VALUES (
      v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success',
      CASE WHEN v_target_code = '1000' THEN 'reclassified_to_cash' ELSE 'reclassified_to_ap' END,
      'Reclassified expense credit account (branch-resolved) after payment status change. Voided old credit legs and inserted ' || v_target_code || '.',
      v_batch_id, v_voided_ids || v_new_tx_id,
      v_credit_amount, v_credit_amount, 'manual', v_actor
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'outcome', 'reclassified',
    'target_account_code', v_target_code,
    'new_transaction_id', v_new_tx_id,
    'voided_transaction_ids', v_voided_ids
  );
END;
$function$;