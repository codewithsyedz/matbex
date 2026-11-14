-- Add cogs_purchase, invoice_payment, purchase_invoice to allowed reference_type values

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
      'purchase_invoice'
    ) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Invalid reference type "%". Allowed types: sale, expense, adjustment, transfer, opening_balance, journal_entry, customer_balance, supplier_payment, cogs_consumption, cogs_purchase, invoice_payment, purchase_invoice.', NEW.reference_type;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;