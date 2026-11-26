-- Fix the post_invoice_payment_to_ledger function to match actual schema
CREATE OR REPLACE FUNCTION post_invoice_payment_to_ledger(
  p_invoice_id UUID,
  p_payment_method TEXT DEFAULT 'cash'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_tenant_id UUID;
  v_batch_id UUID;
  v_ap_account_id UUID;
  v_cash_account_id UUID;
  v_description TEXT;
BEGIN
  -- Get invoice details
  SELECT pi.*, r.tenant_id 
  INTO v_invoice
  FROM purchase_invoices pi
  JOIN restaurants r ON r.id = pi.restaurant_id
  WHERE pi.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  v_tenant_id := v_invoice.tenant_id;

  -- Get Accounts Payable account (2000)
  SELECT id INTO v_ap_account_id
  FROM chart_of_accounts
  WHERE tenant_id = v_tenant_id
    AND account_code = '2000'
    AND is_active = true;

  IF v_ap_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable account (2000) not found';
  END IF;

  -- Get Cash or Bank account based on payment method
  IF p_payment_method = 'bank' OR p_payment_method = 'card' THEN
    SELECT id INTO v_cash_account_id
    FROM chart_of_accounts
    WHERE tenant_id = v_tenant_id
      AND account_code = '1010'
      AND is_active = true;
  ELSE
    SELECT id INTO v_cash_account_id
    FROM chart_of_accounts
    WHERE tenant_id = v_tenant_id
      AND account_code = '1000'
      AND is_active = true;
  END IF;

  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash/Bank account not found';
  END IF;

  v_description := 'Payment for Invoice ' || v_invoice.invoice_number;

  -- Create journal entry batch with correct column names
  INSERT INTO journal_entry_batches (
    tenant_id,
    description,
    entry_type,
    batch_date,
    created_by
  ) VALUES (
    v_tenant_id,
    v_description,
    'invoice_payment',
    CURRENT_DATE,
    auth.uid()
  )
  RETURNING id INTO v_batch_id;

  -- DR Accounts Payable (reduce liability)
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    batch_id,
    transaction_date,
    description,
    debit,
    credit,
    reference_type,
    reference_id,
    created_by
  ) VALUES (
    v_tenant_id,
    v_ap_account_id,
    v_batch_id,
    CURRENT_DATE,
    v_description,
    v_invoice.total_amount,
    NULL,
    'invoice_payment',
    p_invoice_id,
    auth.uid()
  );

  -- CR Cash/Bank (reduce asset)
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    batch_id,
    transaction_date,
    description,
    debit,
    credit,
    reference_type,
    reference_id,
    created_by
  ) VALUES (
    v_tenant_id,
    v_cash_account_id,
    v_batch_id,
    CURRENT_DATE,
    v_description,
    NULL,
    v_invoice.total_amount,
    'invoice_payment',
    p_invoice_id,
    auth.uid()
  );

  -- Update account balances
  UPDATE chart_of_accounts
  SET balance = COALESCE(balance, 0) - v_invoice.total_amount
  WHERE id = v_ap_account_id;

  UPDATE chart_of_accounts
  SET balance = COALESCE(balance, 0) - v_invoice.total_amount
  WHERE id = v_cash_account_id;

  -- Mark invoice as paid
  UPDATE purchase_invoices
  SET status = 'paid'
  WHERE id = p_invoice_id;

  RETURN v_batch_id;
END;
$$;