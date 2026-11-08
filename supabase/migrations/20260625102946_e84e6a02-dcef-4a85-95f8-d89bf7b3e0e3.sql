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
  v_credit_code text;
  v_batch_id uuid;
  v_actor_id uuid;
BEGIN
  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF v_expense.approval_status != 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to ledger';
  END IF;

  IF COALESCE(v_expense.ledger_posted, false) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense has already been posted to ledger';
  END IF;

  SELECT account_type::text INTO v_account_type
  FROM public.chart_of_accounts
  WHERE id = p_account_id;

  IF v_account_type = 'cogs' THEN
    v_debit_account_id := public.resolve_inventory_account_for_cogs(v_expense.tenant_id, p_account_id);
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No inventory asset account found for COGS routing';
    END IF;
  ELSE
    v_debit_account_id := p_account_id;
  END IF;

  IF v_debit_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense must have a Chart of Accounts mapping before posting to ledger';
  END IF;

  IF COALESCE(v_expense.status, 'unpaid') = 'paid' THEN
    v_credit_code := '1000';
  ELSE
    v_credit_code := '2000';
  END IF;

  SELECT id INTO v_credit_account_id
  FROM public.chart_of_accounts
  WHERE tenant_id = v_expense.tenant_id
    AND account_code = v_credit_code
  LIMIT 1;

  IF v_credit_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Counter-account % not found in chart of accounts for this tenant', v_credit_code;
  END IF;

  v_actor_id := COALESCE(auth.uid(), v_expense.approved_by, v_expense.created_by);

  INSERT INTO public.journal_entry_batches (
    tenant_id,
    batch_date,
    description,
    reference_number,
    entry_type,
    created_by,
    is_posted,
    posted_at,
    posted_by,
    journal_type,
    approval_status,
    approved_by,
    approved_at
  ) VALUES (
    v_expense.tenant_id,
    v_expense.expense_date,
    'Expense posting: ' || COALESCE(v_expense.description, v_expense.id::text),
    'EXP-' || v_expense.id::text,
    'expense',
    v_actor_id,
    true,
    now(),
    v_actor_id,
    'expense',
    'approved',
    v_actor_id,
    now()
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_debit_account_id, v_expense.expense_date, v_expense.amount, NULL,
    COALESCE(v_expense.description, 'Expense'),
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  )
  RETURNING id INTO v_debit_tx_id;

  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id, batch_id
  ) VALUES (
    v_expense.tenant_id, v_credit_account_id, v_expense.expense_date, NULL, v_expense.amount,
    COALESCE(v_expense.description, 'Expense') || ' — ' ||
      CASE WHEN v_credit_code = '1000' THEN 'paid (Cash)' ELSE 'on credit (AP)' END,
    'expense', p_expense_id, v_actor_id, v_expense.branch_id, v_batch_id
  );

  UPDATE public.expenses
  SET ledger_posted = true,
      ledger_transaction_id = v_debit_tx_id,
      account_id = p_account_id
  WHERE id = p_expense_id;

  RETURN v_debit_tx_id;
END;
$function$;

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  FOR v_tenant_id IN
    SELECT DISTINCT tenant_id
    FROM public.expenses
    WHERE deleted_at IS NULL
      AND approval_status = 'approved'
      AND COALESCE(ledger_posted, false) = false
      AND account_id IS NOT NULL
  LOOP
    PERFORM * FROM public.reconcile_expense_ledger(v_tenant_id);
  END LOOP;
END $$;