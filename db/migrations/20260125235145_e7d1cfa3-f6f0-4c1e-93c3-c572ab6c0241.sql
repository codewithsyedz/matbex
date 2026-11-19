-- Add ledger tracking to settlement_payments
ALTER TABLE settlement_payments 
ADD COLUMN IF NOT EXISTS ledger_posted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ledger_transaction_id uuid REFERENCES account_transactions(id);

-- Add ledger tracking to customer_balance_adjustments
ALTER TABLE customer_balance_adjustments
ADD COLUMN IF NOT EXISTS ledger_posted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ledger_transaction_id uuid REFERENCES account_transactions(id);

-- Create function to post settlement payment to ledger
-- When customer pays: DR Cash/Bank, CR Accounts Receivable
CREATE OR REPLACE FUNCTION post_settlement_to_ledger(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_invoice RECORD;
  v_restaurant RECORD;
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_ar_account_id uuid;
  v_debit_account_id uuid;
  v_transaction_id uuid;
BEGIN
  -- Get payment details
  SELECT * INTO v_payment FROM settlement_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement payment not found';
  END IF;
  
  IF v_payment.ledger_posted THEN
    RAISE EXCEPTION 'Payment already posted to ledger';
  END IF;
  
  -- Get invoice and restaurant
  SELECT * INTO v_invoice FROM settlement_invoices WHERE id = v_payment.settlement_invoice_id;
  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_payment.restaurant_id;
  
  -- Get COA accounts
  SELECT id INTO v_cash_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_bank_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1010' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_ar_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1100' AND is_active = true LIMIT 1;
  
  IF v_ar_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Receivable (1100) not configured';
  END IF;
  
  -- Determine debit account based on payment method
  IF v_payment.payment_method IN ('cash') THEN
    v_debit_account_id := v_cash_account_id;
  ELSE
    v_debit_account_id := v_bank_account_id;
  END IF;
  
  IF v_debit_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash/Bank account not configured for payment method';
  END IF;
  
  -- Create DEBIT transaction (Cash/Bank increases)
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit, 
    description, reference_type, reference_id
  )
  VALUES (
    v_restaurant.tenant_id, v_debit_account_id, CURRENT_DATE, v_payment.amount,
    'Settlement Payment - Invoice #' || v_invoice.invoice_number, 
    'customer_balance', p_payment_id
  )
  RETURNING id INTO v_transaction_id;
  
  -- Create CREDIT transaction (A/R decreases)
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, credit, 
    description, reference_type, reference_id
  )
  VALUES (
    v_restaurant.tenant_id, v_ar_account_id, CURRENT_DATE, v_payment.amount,
    'Settlement Payment - Invoice #' || v_invoice.invoice_number, 
    'customer_balance', p_payment_id
  );
  
  -- Mark as posted
  UPDATE settlement_payments 
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_payment_id;
  
  RETURN v_transaction_id;
END;
$$;

-- Create function to post balance adjustment to ledger
-- Write-off: DR Bad Debt Expense, CR Accounts Receivable
-- Credit: DR Accounts Receivable, CR Revenue Adjustment
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
  
  IF v_ar_account_id IS NULL OR v_misc_expense_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts not configured';
  END IF;
  
  IF v_adjustment.adjustment_type = 'write_off' THEN
    -- Write-off: DR Bad Debt Expense (6900), CR A/R
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION post_settlement_to_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION post_balance_adjustment_to_ledger(uuid) TO authenticated;