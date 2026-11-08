-- CoA Validation Engine: Ensure data integrity for all transactions

-- 1. Add constraint to ensure debit OR credit is provided (not both zero)
ALTER TABLE public.account_transactions
ADD CONSTRAINT transaction_must_have_amount CHECK (
  COALESCE(debit, 0) > 0 OR COALESCE(credit, 0) > 0
);

-- 2. Add constraint to ensure debit and credit are not both positive (double-entry principle)
ALTER TABLE public.account_transactions
ADD CONSTRAINT transaction_single_side CHECK (
  NOT (COALESCE(debit, 0) > 0 AND COALESCE(credit, 0) > 0)
);

-- 3. Create validation function for account type mapping
CREATE OR REPLACE FUNCTION public.validate_transaction_account_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_account RECORD;
  v_error_msg TEXT;
BEGIN
  -- Check if account exists and is active
  SELECT id, account_code, account_name, account_type, is_active, tenant_id
  INTO v_account
  FROM public.chart_of_accounts
  WHERE id = NEW.account_id;
  
  -- Account must exist
  IF v_account.id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Account ID "%" does not exist in Chart of Accounts. Transaction cannot be saved without a valid CoA mapping.', NEW.account_id;
  END IF;
  
  -- Account must be active
  IF NOT v_account.is_active THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Account "% - %" is inactive. Transactions cannot be posted to inactive accounts.', v_account.account_code, v_account.account_name;
  END IF;
  
  -- Transaction tenant must match account tenant
  IF NEW.tenant_id != v_account.tenant_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Account "% - %" belongs to a different organization. Cross-tenant transactions are not allowed.', v_account.account_code, v_account.account_name;
  END IF;
  
  -- Validate reference_type if provided
  IF NEW.reference_type IS NOT NULL THEN
    IF NEW.reference_type NOT IN ('sale', 'expense', 'adjustment', 'transfer', 'opening_balance', 'journal_entry', 'customer_balance', 'supplier_payment') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Invalid reference type "%". Allowed types: sale, expense, adjustment, transfer, opening_balance, journal_entry, customer_balance, supplier_payment.', NEW.reference_type;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 4. Create trigger for transaction validation
DROP TRIGGER IF EXISTS trigger_validate_transaction ON public.account_transactions;
CREATE TRIGGER trigger_validate_transaction
BEFORE INSERT OR UPDATE ON public.account_transactions
FOR EACH ROW
EXECUTE FUNCTION public.validate_transaction_account_mapping();

-- 5. Create validation function to check account type appropriateness for transaction type
CREATE OR REPLACE FUNCTION public.validate_account_type_for_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_account_type TEXT;
  v_account_name TEXT;
  v_account_code TEXT;
BEGIN
  -- Get account type
  SELECT account_type, account_name, account_code
  INTO v_account_type, v_account_name, v_account_code
  FROM public.chart_of_accounts
  WHERE id = NEW.account_id;
  
  -- Validate account type matches reference type expectations
  IF NEW.reference_type = 'sale' THEN
    IF v_account_type NOT IN ('revenue', 'asset') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Sales transactions must post to Revenue or Asset accounts. Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  ELSIF NEW.reference_type = 'expense' THEN
    IF v_account_type NOT IN ('expense', 'asset', 'liability') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Expense transactions must post to Expense, Asset, or Liability accounts. Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  ELSIF NEW.reference_type = 'customer_balance' THEN
    IF v_account_type NOT IN ('asset', 'revenue') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Customer balance adjustments must post to Asset (Receivables) or Revenue accounts. Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  ELSIF NEW.reference_type = 'supplier_payment' THEN
    IF v_account_type NOT IN ('liability', 'asset', 'cogs') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Supplier payments must post to Liability (Payables), Asset, or COGS accounts. Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 6. Create trigger for account type validation
DROP TRIGGER IF EXISTS trigger_validate_account_type ON public.account_transactions;
CREATE TRIGGER trigger_validate_account_type
BEFORE INSERT OR UPDATE ON public.account_transactions
FOR EACH ROW
WHEN (NEW.reference_type IS NOT NULL)
EXECUTE FUNCTION public.validate_account_type_for_reference();

-- 7. Add index for faster validation lookups
CREATE INDEX IF NOT EXISTS idx_account_transactions_account_id ON public.account_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_account_transactions_reference ON public.account_transactions(reference_type, reference_id);

-- 8. Create a view for validation error tracking (for debugging)
CREATE OR REPLACE VIEW public.coa_validation_rules AS
SELECT 
  'transaction_must_have_amount' as rule_name,
  'Transactions must have either a debit or credit amount greater than zero' as description,
  'constraint' as rule_type
UNION ALL
SELECT 
  'transaction_single_side',
  'Transactions cannot have both debit and credit amounts (double-entry enforcement)',
  'constraint'
UNION ALL
SELECT 
  'validate_transaction_account_mapping',
  'Ensures account exists, is active, and belongs to the same tenant',
  'trigger'
UNION ALL
SELECT 
  'validate_account_type_for_reference',
  'Validates that account type is appropriate for the transaction reference type',
  'trigger';