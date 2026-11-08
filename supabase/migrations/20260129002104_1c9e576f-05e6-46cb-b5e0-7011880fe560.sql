-- Update the ledger posting function to handle 'settlement' type adjustments
-- Settlement: DR Cash/Bank (1000/1010), CR A/R (1100)
CREATE OR REPLACE FUNCTION post_balance_adjustment_to_ledger(p_adjustment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adjustment RECORD;
  v_ar_account_id uuid;
  v_misc_expense_id uuid;
  v_cash_account_id uuid;
  v_transaction_id uuid;
BEGIN
  -- Get adjustment details
  SELECT * INTO v_adjustment FROM customer_balance_adjustments WHERE id = p_adjustment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Balance adjustment not found';
  END IF;
  
  IF v_adjustment.ledger_posted THEN
    RAISE EXCEPTION 'Adjustment already posted to ledger';
  END IF;
  
  -- Get COA accounts
  SELECT id INTO v_ar_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_adjustment.tenant_id AND account_code = '1100' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_misc_expense_id FROM chart_of_accounts 
  WHERE tenant_id = v_adjustment.tenant_id AND account_code = '6900' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_cash_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_adjustment.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  
  IF v_ar_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Receivable (1100) not configured';
  END IF;
  
  IF v_adjustment.adjustment_type = 'write_off' THEN
    -- Write-off: DR Bad Debt Expense (6900), CR A/R
    IF v_misc_expense_id IS NULL THEN
      RAISE EXCEPTION 'Bad Debt Expense account (6900) not configured';
    END IF;
    
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, debit, 
      description, reference_type, reference_id
    )
    VALUES (
      v_adjustment.tenant_id, v_misc_expense_id, CURRENT_DATE, v_adjustment.amount,
      'Debt Write-off: ' || v_adjustment.reason, 'customer_balance', p_adjustment_id
    )
    RETURNING id INTO v_transaction_id;
    
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit, 
      description, reference_type, reference_id
    )
    VALUES (
      v_adjustment.tenant_id, v_ar_account_id, CURRENT_DATE, v_adjustment.amount,
      'Debt Write-off: ' || v_adjustment.reason, 'customer_balance', p_adjustment_id
    );
    
  ELSIF v_adjustment.adjustment_type = 'settlement' THEN
    -- Settlement payment received: DR Cash (1000), CR A/R (1100)
    IF v_cash_account_id IS NULL THEN
      RAISE EXCEPTION 'Cash account (1000) not configured';
    END IF;
    
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, debit, 
      description, reference_type, reference_id
    )
    VALUES (
      v_adjustment.tenant_id, v_cash_account_id, CURRENT_DATE, v_adjustment.amount,
      'Settlement Payment: ' || COALESCE(v_adjustment.reference_number, v_adjustment.reason), 
      'settlement', p_adjustment_id
    )
    RETURNING id INTO v_transaction_id;
    
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit, 
      description, reference_type, reference_id
    )
    VALUES (
      v_adjustment.tenant_id, v_ar_account_id, CURRENT_DATE, v_adjustment.amount,
      'Settlement Payment: ' || COALESCE(v_adjustment.reference_number, v_adjustment.reason), 
      'settlement', p_adjustment_id
    );
    
  ELSIF v_adjustment.adjustment_type = 'credit' THEN
    -- Credit given: DR A/R (increase debt), CR Revenue Adjustment
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, debit, 
      description, reference_type, reference_id
    )
    VALUES (
      v_adjustment.tenant_id, v_ar_account_id, CURRENT_DATE, v_adjustment.amount,
      'Customer Credit: ' || v_adjustment.reason, 'customer_balance', p_adjustment_id
    )
    RETURNING id INTO v_transaction_id;
    
  ELSIF v_adjustment.adjustment_type = 'debit' THEN
    -- Debit adjustment: CR A/R (reduce debt)
    INSERT INTO account_transactions (
      tenant_id, account_id, transaction_date, credit, 
      description, reference_type, reference_id
    )
    VALUES (
      v_adjustment.tenant_id, v_ar_account_id, CURRENT_DATE, v_adjustment.amount,
      'Balance Adjustment: ' || v_adjustment.reason, 'customer_balance', p_adjustment_id
    )
    RETURNING id INTO v_transaction_id;
  END IF;
  
  -- Mark as posted
  UPDATE customer_balance_adjustments 
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_adjustment_id;
  
  RETURN v_transaction_id;
END;
$$;