-- Create RPC to auto-post inventory purchase to ledger
-- DR Inventory Asset (1200), CR Cash/AP based on payment method

CREATE OR REPLACE FUNCTION post_inventory_purchase_to_ledger(
  p_purchase_id UUID,
  p_payment_method TEXT DEFAULT 'cash'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase RECORD;
  v_batch_id UUID;
  v_tenant_id UUID;
  v_user_id UUID;
  v_inventory_account_id UUID;
  v_credit_account_id UUID;
  v_item_name TEXT;
BEGIN
  v_user_id := auth.uid();
  
  -- Get purchase details with restaurant and inventory item info
  SELECT p.*, r.tenant_id, ii.name as item_name
  INTO v_purchase
  FROM purchases p
  JOIN restaurants r ON r.id = p.restaurant_id
  JOIN inventory_items ii ON ii.id = p.inventory_item_id
  WHERE p.id = p_purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;

  v_tenant_id := v_purchase.tenant_id;
  v_item_name := v_purchase.item_name;

  -- Get Inventory - Food account (1200) for debit
  SELECT id INTO v_inventory_account_id
  FROM chart_of_accounts
  WHERE tenant_id = v_tenant_id
    AND account_code = '1200'
    AND is_active = TRUE
  LIMIT 1;

  IF v_inventory_account_id IS NULL THEN
    -- Try to find any inventory asset account
    SELECT id INTO v_inventory_account_id
    FROM chart_of_accounts
    WHERE tenant_id = v_tenant_id
      AND account_type = 'asset'
      AND account_code LIKE '12%'
      AND is_active = TRUE
    LIMIT 1;
  END IF;

  IF v_inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Inventory account (1200) not found. Please create it in Chart of Accounts.';
  END IF;

  -- Determine credit account based on payment method
  IF p_payment_method = 'cash' THEN
    -- CR Cash on Hand (1000)
    SELECT id INTO v_credit_account_id
    FROM chart_of_accounts
    WHERE tenant_id = v_tenant_id
      AND account_code = '1000'
      AND is_active = TRUE
    LIMIT 1;
    
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Cash account (1000) not found. Please create it in Chart of Accounts.';
    END IF;
  ELSIF p_payment_method = 'card' OR p_payment_method = 'bank' THEN
    -- CR Bank Account (1010)
    SELECT id INTO v_credit_account_id
    FROM chart_of_accounts
    WHERE tenant_id = v_tenant_id
      AND account_code = '1010'
      AND is_active = TRUE
    LIMIT 1;
    
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Bank account (1010) not found. Please create it in Chart of Accounts.';
    END IF;
  ELSE
    -- CR Accounts Payable (2000) for credit purchases
    SELECT id INTO v_credit_account_id
    FROM chart_of_accounts
    WHERE tenant_id = v_tenant_id
      AND account_code = '2000'
      AND is_active = TRUE
    LIMIT 1;
    
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Accounts Payable account (2000) not found. Please create it in Chart of Accounts.';
    END IF;
  END IF;

  -- Create journal entry batch
  INSERT INTO journal_entry_batches (tenant_id, description, created_by, batch_date, entry_type)
  VALUES (
    v_tenant_id,
    'Inventory Purchase: ' || v_item_name,
    v_user_id,
    v_purchase.received_at::date,
    'inventory_purchase'
  )
  RETURNING id INTO v_batch_id;

  -- DR Inventory Asset
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit, description, 
    reference_type, reference_id, created_by, batch_id
  ) VALUES (
    v_tenant_id, 
    v_inventory_account_id, 
    v_purchase.received_at::date, 
    v_purchase.total_cost,
    'Inventory Purchase: ' || v_item_name || ' (' || v_purchase.quantity_received || ' units @ ' || v_purchase.unit_cost || ')',
    'inventory_purchase', 
    p_purchase_id::text, 
    v_user_id, 
    v_batch_id
  );

  -- CR Cash/Bank/AP
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, credit, description,
    reference_type, reference_id, created_by, batch_id
  ) VALUES (
    v_tenant_id, 
    v_credit_account_id, 
    v_purchase.received_at::date, 
    v_purchase.total_cost,
    'Inventory Purchase: ' || v_item_name || ' (' || v_purchase.quantity_received || ' units @ ' || v_purchase.unit_cost || ')',
    'inventory_purchase', 
    p_purchase_id::text, 
    v_user_id, 
    v_batch_id
  );

  -- Update account balances
  -- Inventory increases (debit = increase for assets)
  UPDATE chart_of_accounts 
  SET balance = COALESCE(balance, 0) + v_purchase.total_cost 
  WHERE id = v_inventory_account_id;
  
  -- Cash/Bank decreases or AP increases (credit)
  IF p_payment_method IN ('cash', 'card', 'bank') THEN
    -- Asset decreases (credit = decrease for assets)
    UPDATE chart_of_accounts 
    SET balance = COALESCE(balance, 0) - v_purchase.total_cost 
    WHERE id = v_credit_account_id;
  ELSE
    -- Liability increases (credit = increase for liabilities)
    UPDATE chart_of_accounts 
    SET balance = COALESCE(balance, 0) + v_purchase.total_cost 
    WHERE id = v_credit_account_id;
  END IF;

  RETURN v_batch_id;
END;
$$;

-- Add inventory_purchase to allowed reference types
CREATE OR REPLACE FUNCTION public.validate_transaction_account_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_type TEXT;
  v_is_active BOOLEAN;
BEGIN
  -- Verify account exists and is active
  SELECT account_type, is_active
  INTO v_account_type, v_is_active
  FROM chart_of_accounts
  WHERE id = NEW.account_id
    AND tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Account not found or does not belong to this tenant.';
  END IF;

  IF NOT v_is_active THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Cannot post to inactive account.';
  END IF;

  -- Validate reference_type if provided (expanded list)
  IF NEW.reference_type IS NOT NULL THEN
    IF NEW.reference_type NOT IN (
      'sale',
      'expense',
      'adjustment',
      'transfer',
      'opening_balance',
      'journal_entry',
      'customer_balance',
      'supplier_payment',
      'cogs_consumption',
      'cogs_purchase',
      'invoice_payment',
      'purchase_invoice',
      'inventory_purchase'
    ) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Invalid reference type "%". Allowed types: sale, expense, adjustment, transfer, opening_balance, journal_entry, customer_balance, supplier_payment, cogs_consumption, cogs_purchase, invoice_payment, purchase_invoice, inventory_purchase.', NEW.reference_type;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;