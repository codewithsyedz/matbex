-- Fix type mismatch: account_transactions.reference_id is UUID, so don't insert text

CREATE OR REPLACE FUNCTION public.post_purchase_invoice_to_ledger(
  p_invoice_id UUID,
  p_account_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_batch_id UUID;
  v_tenant_id UUID;
  v_user_id UUID;
  v_ap_account_id UUID;
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

  IF v_invoice.ledger_posted = TRUE THEN
    RAISE EXCEPTION 'Invoice already posted to ledger';
  END IF;

  v_tenant_id := v_invoice.tenant_id;
  v_user_id := auth.uid();

  -- Verify target account belongs to tenant and is active
  PERFORM 1
  FROM chart_of_accounts
  WHERE id = p_account_id
    AND tenant_id = v_tenant_id
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Invalid or inactive account selected';
  END IF;

  -- Get Accounts Payable account (2000)
  SELECT id
  INTO v_ap_account_id
  FROM chart_of_accounts
  WHERE tenant_id = v_tenant_id
    AND account_code = '2000'
    AND is_active = TRUE
  LIMIT 1;

  IF v_ap_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Accounts Payable account (2000) not found. Please create it in Chart of Accounts.';
  END IF;

  -- Create journal entry batch
  INSERT INTO journal_entry_batches (
    tenant_id,
    description,
    created_by,
    batch_date,
    entry_type
  )
  VALUES (
    v_tenant_id,
    'Purchase Invoice: ' || v_invoice.invoice_number,
    v_user_id,
    v_invoice.invoice_date,
    'purchase_invoice'
  )
  RETURNING id INTO v_batch_id;

  -- DR COGS/Expense/Asset account (specified by user)
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    transaction_date,
    debit,
    description,
    reference_type,
    reference_id,
    created_by,
    batch_id
  )
  VALUES (
    v_tenant_id,
    p_account_id,
    v_invoice.invoice_date,
    v_invoice.total_amount,
    'Purchase Invoice: ' || v_invoice.invoice_number || COALESCE(' - ' || (SELECT name FROM suppliers WHERE id = v_invoice.supplier_id), ''),
    'cogs_purchase',
    p_invoice_id,
    v_user_id,
    v_batch_id
  );

  -- CR Accounts Payable
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    transaction_date,
    credit,
    description,
    reference_type,
    reference_id,
    created_by,
    batch_id
  )
  VALUES (
    v_tenant_id,
    v_ap_account_id,
    v_invoice.invoice_date,
    v_invoice.total_amount,
    'Purchase Invoice: ' || v_invoice.invoice_number || COALESCE(' - ' || (SELECT name FROM suppliers WHERE id = v_invoice.supplier_id), ''),
    'cogs_purchase',
    p_invoice_id,
    v_user_id,
    v_batch_id
  );

  -- Update invoice as posted
  UPDATE purchase_invoices
  SET account_id = p_account_id,
      ledger_posted = TRUE,
      ledger_transaction_id = v_batch_id
  WHERE id = p_invoice_id;

  -- Update account balances
  UPDATE chart_of_accounts
  SET balance = COALESCE(balance, 0) + v_invoice.total_amount
  WHERE id = p_account_id;

  UPDATE chart_of_accounts
  SET balance = COALESCE(balance, 0) + v_invoice.total_amount
  WHERE id = v_ap_account_id;

  RETURN v_batch_id;
END;
$$;
