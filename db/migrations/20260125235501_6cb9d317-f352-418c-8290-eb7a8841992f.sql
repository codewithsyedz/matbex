-- Add COA mapping to overhead_allocation
ALTER TABLE overhead_allocation 
ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES chart_of_accounts(id),
ADD COLUMN IF NOT EXISTS ledger_posted boolean DEFAULT false;

-- Add COA tracking to payroll_records
ALTER TABLE payroll_records
ADD COLUMN IF NOT EXISTS ledger_posted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ledger_transaction_id uuid REFERENCES account_transactions(id);

-- Create function to post payroll to ledger
-- DR Wages & Salaries (6100), CR Cash/Bank (1000/1010)
CREATE OR REPLACE FUNCTION post_payroll_to_ledger(p_payroll_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payroll RECORD;
  v_restaurant RECORD;
  v_wages_account_id uuid;
  v_cash_account_id uuid;
  v_transaction_id uuid;
  v_staff_name text;
BEGIN
  -- Get payroll details
  SELECT pr.*, s.name as staff_name INTO v_payroll 
  FROM payroll_records pr
  JOIN staff s ON pr.staff_id = s.id
  WHERE pr.id = p_payroll_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll record not found';
  END IF;
  
  IF v_payroll.ledger_posted THEN
    RAISE EXCEPTION 'Payroll already posted to ledger';
  END IF;
  
  -- Get restaurant
  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_payroll.restaurant_id;
  
  -- Get COA accounts
  SELECT id INTO v_wages_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '6100' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_cash_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_restaurant.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  
  IF v_wages_account_id IS NULL OR v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts (6100, 1000) not configured';
  END IF;
  
  -- DEBIT: Wages & Salaries expense
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit, 
    description, reference_type, reference_id
  )
  VALUES (
    v_restaurant.tenant_id, v_wages_account_id, v_payroll.payment_date, v_payroll.amount,
    'Salary Payment - ' || v_payroll.staff_name, 'expense', p_payroll_id
  )
  RETURNING id INTO v_transaction_id;
  
  -- CREDIT: Cash paid out
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, credit, 
    description, reference_type, reference_id
  )
  VALUES (
    v_restaurant.tenant_id, v_cash_account_id, v_payroll.payment_date, v_payroll.amount,
    'Salary Payment - ' || v_payroll.staff_name, 'expense', p_payroll_id
  );
  
  -- Mark as posted
  UPDATE payroll_records 
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_payroll_id;
  
  RETURN v_transaction_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION post_payroll_to_ledger(uuid) TO authenticated;