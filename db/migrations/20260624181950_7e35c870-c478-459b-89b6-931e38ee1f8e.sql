
CREATE OR REPLACE FUNCTION public.post_expense_to_ledger(p_expense_id uuid, p_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expense RECORD;
  v_debit_tx_id uuid;
  v_account_type text;
  v_debit_account_id uuid;
  v_credit_account_id uuid;
  v_credit_code text;
BEGIN
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_expense.approval_status != 'approved' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only approved expenses can be posted to ledger';
  END IF;
  IF v_expense.ledger_posted THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense has already been posted to ledger';
  END IF;

  SELECT account_type::text INTO v_account_type
  FROM public.chart_of_accounts WHERE id = p_account_id;

  IF v_account_type = 'cogs' THEN
    v_debit_account_id := public.resolve_inventory_account_for_cogs(v_expense.tenant_id, p_account_id);
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: No inventory asset account found for COGS routing';
    END IF;
  ELSE
    v_debit_account_id := p_account_id;
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

  -- DEBIT leg
  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id
  ) VALUES (
    v_expense.tenant_id, v_debit_account_id, v_expense.expense_date, v_expense.amount, NULL,
    COALESCE(v_expense.description, 'Expense'),
    'expense', p_expense_id, auth.uid(), v_expense.branch_id
  )
  RETURNING id INTO v_debit_tx_id;

  -- CREDIT leg
  INSERT INTO public.account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, branch_id
  ) VALUES (
    v_expense.tenant_id, v_credit_account_id, v_expense.expense_date, NULL, v_expense.amount,
    COALESCE(v_expense.description, 'Expense') || ' — ' ||
      CASE WHEN v_credit_code = '1000' THEN 'paid (Cash)' ELSE 'on credit (AP)' END,
    'expense', p_expense_id, auth.uid(), v_expense.branch_id
  );

  UPDATE public.expenses
  SET ledger_posted = TRUE,
      ledger_transaction_id = v_debit_tx_id,
      account_id = p_account_id
  WHERE id = p_expense_id;

  RETURN v_debit_tx_id;
END;
$$;

-- Backfill missing credit legs on previously-posted expenses
DO $$
DECLARE
  r RECORD;
  v_credit_code text;
  v_credit_account_id uuid;
BEGIN
  FOR r IN
    SELECT e.id            AS expense_id,
           e.tenant_id,
           e.expense_date,
           e.amount,
           e.description,
           e.status,
           e.branch_id,
           e.created_by
    FROM public.expenses e
    WHERE e.ledger_posted = true
      AND e.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.account_transactions d
        WHERE d.reference_type = 'expense'
          AND d.reference_id = e.id
          AND d.debit IS NOT NULL
          AND COALESCE(d.is_voided, false) = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.account_transactions c
        WHERE c.reference_type = 'expense'
          AND c.reference_id  = e.id
          AND c.credit IS NOT NULL
          AND COALESCE(c.is_voided, false) = false
      )
  LOOP
    v_credit_code := CASE WHEN COALESCE(r.status, 'unpaid') = 'paid' THEN '1000' ELSE '2000' END;

    SELECT id INTO v_credit_account_id
    FROM public.chart_of_accounts
    WHERE tenant_id = r.tenant_id
      AND account_code = v_credit_code
    LIMIT 1;

    IF v_credit_account_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit,
      description, reference_type, reference_id, created_by, branch_id
    ) VALUES (
      r.tenant_id, v_credit_account_id, r.expense_date, NULL, r.amount,
      COALESCE(r.description, 'Expense') || ' — backfilled counter-leg (' ||
        CASE WHEN v_credit_code = '1000' THEN 'Cash' ELSE 'AP' END || ')',
      'expense', r.expense_id, r.created_by, r.branch_id
    );
  END LOOP;
END $$;
