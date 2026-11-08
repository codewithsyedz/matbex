-- Add ledger tracking columns to daily_sales_summary
ALTER TABLE daily_sales_summary 
ADD COLUMN IF NOT EXISTS ledger_posted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ledger_batch_id uuid REFERENCES journal_entry_batches(id);

-- Create function to post daily sales to ledger
CREATE OR REPLACE FUNCTION post_daily_sales_to_ledger(p_sales_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sales RECORD;
  v_batch_id uuid;
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_ar_account_id uuid;
  v_revenue_account_id uuid;
  v_delivery_revenue_id uuid;
BEGIN
  -- Get sales record
  SELECT * INTO v_sales FROM daily_sales_summary WHERE id = p_sales_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales record not found';
  END IF;
  
  IF v_sales.ledger_posted THEN
    RAISE EXCEPTION 'Sales already posted to ledger';
  END IF;
  
  -- Get COA accounts for this tenant
  SELECT id INTO v_cash_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_bank_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1010' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_ar_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1100' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_sales.tenant_id AND account_code = '4000' AND is_active = true LIMIT 1;
  
  SELECT id INTO v_delivery_revenue_id FROM chart_of_accounts 
  WHERE tenant_id = v_sales.tenant_id AND account_code = '4100' AND is_active = true LIMIT 1;
  
  -- Use main revenue if delivery revenue not found
  IF v_delivery_revenue_id IS NULL THEN
    v_delivery_revenue_id := v_revenue_account_id;
  END IF;
  
  -- Check all required accounts exist
  IF v_cash_account_id IS NULL OR v_bank_account_id IS NULL OR v_revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts not configured for tenant';
  END IF;
  
  -- Create journal entry batch
  INSERT INTO journal_entry_batches (tenant_id, description, entry_date, created_by, status)
  VALUES (
    v_sales.tenant_id,
    'Daily Sales - ' || v_sales.sales_date::text,
    v_sales.sales_date,
    v_sales.created_by,
    'posted'
  )
  RETURNING id INTO v_batch_id;
  
  -- DEBIT: Cash on Hand (for cash sales)
  IF v_sales.cash_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_cash_account_id, v_sales.sales_date, v_sales.cash_sales, 'Cash Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;
  
  -- DEBIT: Bank Account (for card sales)
  IF v_sales.card_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_bank_account_id, v_sales.sales_date, v_sales.card_sales, 'Card Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;
  
  -- DEBIT: Accounts Receivable (for delivery sales - platforms owe us)
  IF v_sales.delivery_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_ar_account_id, v_sales.sales_date, v_sales.delivery_sales, 'Delivery Sales Receivable - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;
  
  -- DEBIT: Cash/Bank for other sales (assume cash)
  IF v_sales.other_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_cash_account_id, v_sales.sales_date, v_sales.other_sales, 'Other Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;
  
  -- CREDIT: Revenue accounts
  -- Food/Beverage Sales (cash + card + other)
  IF (v_sales.cash_sales + v_sales.card_sales + v_sales.other_sales) > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_revenue_account_id, v_sales.sales_date, 
            v_sales.cash_sales + v_sales.card_sales + v_sales.other_sales, 
            'Sales Revenue - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;
  
  -- Delivery Revenue
  IF v_sales.delivery_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_delivery_revenue_id, v_sales.sales_date, v_sales.delivery_sales, 
            'Delivery Revenue - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;
  
  -- Mark as posted
  UPDATE daily_sales_summary 
  SET ledger_posted = true, ledger_batch_id = v_batch_id
  WHERE id = p_sales_id;
  
  RETURN v_batch_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION post_daily_sales_to_ledger(uuid) TO authenticated;