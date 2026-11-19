-- Add ledger tracking columns to supplier_payments
ALTER TABLE public.supplier_payments
ADD COLUMN IF NOT EXISTS ledger_posted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ledger_transaction_id uuid REFERENCES public.account_transactions(id);

-- Create function to post supplier payment to ledger
CREATE OR REPLACE FUNCTION public.post_supplier_payment_to_ledger(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_tenant_id uuid;
  v_ap_account_id uuid;
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_payment_account_id uuid;
  v_batch_id uuid;
  v_transaction_id uuid;
  v_supplier_name text;
BEGIN
  -- Get payment details
  SELECT sp.*, s.name as supplier_name, r.tenant_id
  INTO v_payment
  FROM supplier_payments sp
  JOIN suppliers s ON s.id = sp.supplier_id
  JOIN restaurants r ON r.id = sp.restaurant_id
  WHERE sp.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier payment not found';
  END IF;

  IF v_payment.ledger_posted THEN
    RAISE EXCEPTION 'Payment already posted to ledger';
  END IF;

  v_tenant_id := v_payment.tenant_id;
  v_supplier_name := v_payment.supplier_name;

  -- Get account IDs
  SELECT id INTO v_ap_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_tenant_id AND account_code = '2000' AND is_active = true;

  SELECT id INTO v_cash_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_tenant_id AND account_code = '1000' AND is_active = true;

  SELECT id INTO v_bank_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_tenant_id AND account_code = '1010' AND is_active = true;

  IF v_ap_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable account (2000) not found';
  END IF;

  -- Determine payment account based on method
  IF v_payment.payment_method IN ('cash') THEN
    v_payment_account_id := v_cash_account_id;
  ELSE
    v_payment_account_id := COALESCE(v_bank_account_id, v_cash_account_id);
  END IF;

  IF v_payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash/Bank account not found';
  END IF;

  -- Create journal batch
  INSERT INTO journal_entry_batches (
    tenant_id, batch_date, description, reference_number, 
    entry_type, created_by, is_posted, posted_at, posted_by
  ) VALUES (
    v_tenant_id, v_payment.payment_date,
    'Supplier Payment: ' || v_supplier_name,
    v_payment.reference_number,
    'adjustment', v_payment.created_by, true, now(), v_payment.created_by
  ) RETURNING id INTO v_batch_id;

  -- DR Accounts Payable (reduce liability)
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, batch_id
  ) VALUES (
    v_tenant_id, v_ap_account_id, v_payment.payment_date,
    v_payment.amount, NULL,
    'Payment to ' || v_supplier_name,
    'supplier_payment', p_payment_id, v_payment.created_by, v_batch_id
  ) RETURNING id INTO v_transaction_id;

  -- CR Cash/Bank (reduce asset)
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit, credit,
    description, reference_type, reference_id, created_by, batch_id
  ) VALUES (
    v_tenant_id, v_payment_account_id, v_payment.payment_date,
    NULL, v_payment.amount,
    'Payment to ' || v_supplier_name,
    'supplier_payment', p_payment_id, v_payment.created_by, v_batch_id
  );

  -- Mark payment as posted
  UPDATE supplier_payments
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_payment_id;

  RETURN v_batch_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.post_supplier_payment_to_ledger(uuid) TO authenticated;