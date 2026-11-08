-- ============================================================
-- STRICT COGS/INVENTORY TRANSACTION VALIDATION
-- Separates Inventory (assets) from COGS (expenses) with 
-- entry-type-specific double-entry rules
-- ============================================================

-- Add entry_type enum for journal entries if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_entry_type') THEN
    CREATE TYPE journal_entry_type AS ENUM (
      'purchase',       -- Inventory purchases: DR Inventory, CR Cash/Bank/AP
      'consumption',    -- COGS recognition: DR COGS, CR Inventory
      'sale',           -- Sales: DR Cash/Bank/AR, CR Revenue
      'expense',        -- Operating expenses: DR Expense, CR Cash/Bank/AP
      'adjustment',     -- Generic adjustments
      'correction',     -- Corrections/reversals
      'reversal',       -- Reversal entries
      'opening_balance' -- Opening balances
    );
  END IF;
END $$;

-- Add column to journal_entry_batches if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'journal_entry_batches' 
    AND column_name = 'journal_type'
  ) THEN
    ALTER TABLE public.journal_entry_batches 
    ADD COLUMN journal_type TEXT DEFAULT 'adjustment';
  END IF;
END $$;

-- ============================================================
-- VALIDATION FUNCTION: Enforce entry-type-specific account rules
-- ============================================================
CREATE OR REPLACE FUNCTION validate_journal_entry_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_batch RECORD;
  v_line RECORD;
  v_account RECORD;
  v_has_inventory_debit BOOLEAN := FALSE;
  v_has_inventory_credit BOOLEAN := FALSE;
  v_has_cogs_debit BOOLEAN := FALSE;
  v_has_cogs_credit BOOLEAN := FALSE;
  v_has_cash_bank_credit BOOLEAN := FALSE;
  v_has_ap_credit BOOLEAN := FALSE;
  v_has_revenue_credit BOOLEAN := FALSE;
  v_has_cash_bank_ar_debit BOOLEAN := FALSE;
BEGIN
  -- Get the batch info
  SELECT * INTO v_batch 
  FROM journal_entry_batches 
  WHERE id = NEW.batch_id;
  
  -- Skip validation if no batch or batch type is null
  IF v_batch IS NULL OR v_batch.journal_type IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get account info for this transaction
  SELECT * INTO v_account 
  FROM chart_of_accounts 
  WHERE id = NEW.account_id;
  
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Account not found for transaction.';
  END IF;
  
  -- ============================================================
  -- PURCHASE ENTRIES: DR Inventory (1200-1299), CR Cash/Bank/AP
  -- ============================================================
  IF v_batch.journal_type = 'purchase' THEN
    -- Check if this is an Inventory account (1200-1299)
    IF v_account.account_code >= '1200' AND v_account.account_code < '1300' THEN
      -- Inventory can only be DEBITED in purchases (buying stock)
      IF NEW.credit IS NOT NULL AND NEW.credit > 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchases increase Inventory. Inventory accounts (1200-1299) must be DEBITED, not credited. Use a CONSUMPTION entry to reduce inventory.';
      END IF;
    -- Check if this is a COGS account (5000-5999)
    ELSIF v_account.account_type = 'cogs' OR (v_account.account_code >= '5000' AND v_account.account_code < '6000') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Purchases should not hit COGS accounts (5000-5999). Purchase entries post to Inventory (1200-1299). To recognize cost, use a CONSUMPTION entry.';
    -- Credit side must be Cash (1000), Bank (1010), or AP (2000-2999)
    ELSIF NEW.credit IS NOT NULL AND NEW.credit > 0 THEN
      IF NOT (
        (v_account.account_code >= '1000' AND v_account.account_code < '1200') OR  -- Cash/Bank
        (v_account.account_code >= '2000' AND v_account.account_code < '3000')     -- Liabilities (AP)
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchase credit entries must use Cash (1000-1199) or Accounts Payable (2000-2999). Account "% - %" is not valid for purchase credits.', v_account.account_code, v_account.account_name;
      END IF;
    END IF;
  
  -- ============================================================
  -- CONSUMPTION ENTRIES: DR COGS (5000-5999), CR Inventory (1200-1299)
  -- ============================================================
  ELSIF v_batch.journal_type = 'consumption' THEN
    -- DEBIT side must be COGS (5000-5999)
    IF NEW.debit IS NOT NULL AND NEW.debit > 0 THEN
      IF NOT (v_account.account_type = 'cogs' OR (v_account.account_code >= '5000' AND v_account.account_code < '6000')) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: COGS/Consumption entries must DEBIT a COGS account (5000-5999). Account "% - %" is type "%". Consumption moves value from Inventory to Cost.', 
          v_account.account_code, v_account.account_name, v_account.account_type;
      END IF;
    END IF;
    
    -- CREDIT side must be Inventory (1200-1299)
    IF NEW.credit IS NOT NULL AND NEW.credit > 0 THEN
      IF NOT (v_account.account_code >= '1200' AND v_account.account_code < '1300') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: COGS/Consumption entries must CREDIT an Inventory account (1200-1299). Account "% - %" is not an Inventory account. Consumption reduces inventory value.', 
          v_account.account_code, v_account.account_name;
      END IF;
    END IF;
  
  -- ============================================================
  -- SALE ENTRIES: DR Cash/Bank/AR (1000-1199), CR Revenue (4000-4999)
  -- ============================================================
  ELSIF v_batch.journal_type = 'sale' THEN
    -- No Inventory or COGS in sales entries
    IF v_account.account_code >= '1200' AND v_account.account_code < '1300' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Sales entries must not include Inventory accounts (1200-1299). Use CONSUMPTION entries to recognize COGS separately from revenue.';
    END IF;
    
    IF v_account.account_type = 'cogs' OR (v_account.account_code >= '5000' AND v_account.account_code < '6000') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Sales entries must not include COGS accounts (5000-5999). Use CONSUMPTION entries to recognize cost of goods sold.';
    END IF;
    
    -- DEBIT must be Cash/Bank/AR (1000-1199)
    IF NEW.debit IS NOT NULL AND NEW.debit > 0 THEN
      IF NOT (v_account.account_code >= '1000' AND v_account.account_code < '1200') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Sales debit entries must use Cash, Bank, or Accounts Receivable (1000-1199). Account "% - %" is not valid.', v_account.account_code, v_account.account_name;
      END IF;
    END IF;
    
    -- CREDIT must be Revenue (4000-4999) or Liability (VAT payable 2000-2999)
    IF NEW.credit IS NOT NULL AND NEW.credit > 0 THEN
      IF NOT (
        (v_account.account_code >= '4000' AND v_account.account_code < '5000') OR  -- Revenue
        (v_account.account_code >= '2000' AND v_account.account_code < '3000')     -- Liabilities (VAT)
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Sales credit entries must use Revenue (4000-4999) or Liability accounts (for VAT). Account "% - %" is not valid.', v_account.account_code, v_account.account_name;
      END IF;
    END IF;
  
  -- ============================================================
  -- EXPENSE ENTRIES: DR Expense (6000-6999), CR Cash/Bank/AP
  -- ============================================================
  ELSIF v_batch.journal_type = 'expense' THEN
    -- No Inventory in expense entries
    IF v_account.account_code >= '1200' AND v_account.account_code < '1300' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Expense entries should not use Inventory accounts (1200-1299). For inventory purchases, use PURCHASE entry type.';
    END IF;
    
    -- DEBIT should be Expense or COGS
    IF NEW.debit IS NOT NULL AND NEW.debit > 0 THEN
      IF NOT (
        v_account.account_type = 'expense' OR 
        v_account.account_type = 'cogs' OR
        (v_account.account_code >= '5000' AND v_account.account_code < '7000')
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Expense debit entries should use Expense (6000-6999) or COGS (5000-5999) accounts. Account "% - %" is type "%".', 
          v_account.account_code, v_account.account_name, v_account.account_type;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$func$;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS trg_validate_journal_entry_accounts ON account_transactions;
CREATE TRIGGER trg_validate_journal_entry_accounts
  BEFORE INSERT ON account_transactions
  FOR EACH ROW
  WHEN (NEW.batch_id IS NOT NULL)
  EXECUTE FUNCTION validate_journal_entry_accounts();

-- ============================================================
-- SEED ACCOUNTS: Ensure essential accounts exist
-- ============================================================
-- This function ensures standard accounts exist for a tenant
CREATE OR REPLACE FUNCTION ensure_standard_coa_accounts(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  -- Insert standard accounts if they don't exist
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES 
    -- Asset accounts (1000-1999)
    (p_tenant_id, '1000', 'Cash on Hand', 'asset', 'Physical cash in registers and safes', true),
    (p_tenant_id, '1010', 'Bank Account', 'asset', 'Primary bank account', true),
    (p_tenant_id, '1100', 'Accounts Receivable', 'asset', 'Money owed by customers', true),
    (p_tenant_id, '1200', 'Inventory - Food', 'asset', 'Food inventory on hand', true),
    (p_tenant_id, '1210', 'Inventory - Beverages', 'asset', 'Beverage inventory on hand', true),
    (p_tenant_id, '1220', 'Inventory - Packaging', 'asset', 'Packaging and supplies inventory', true),
    -- Liability accounts (2000-2999)
    (p_tenant_id, '2000', 'Accounts Payable', 'liability', 'Money owed to suppliers', true),
    (p_tenant_id, '2100', 'Accounts Payable - Vendors', 'liability', 'Payables to vendors', true),
    (p_tenant_id, '2200', 'VAT Payable', 'liability', 'Value Added Tax liability', true),
    -- Revenue accounts (4000-4999)
    (p_tenant_id, '4000', 'Food & Beverage Sales', 'revenue', 'Revenue from food and beverage sales', true),
    (p_tenant_id, '4100', 'Delivery Sales', 'revenue', 'Revenue from delivery orders', true),
    -- COGS accounts (5000-5999)
    (p_tenant_id, '5000', 'Cost of Food', 'cogs', 'Cost of food sold', true),
    (p_tenant_id, '5010', 'Cost of Beverages', 'cogs', 'Cost of beverages sold', true),
    (p_tenant_id, '5020', 'Cost of Packaging', 'cogs', 'Cost of packaging materials used', true),
    -- Expense accounts (6000-6999)
    (p_tenant_id, '6000', 'Rent Expense', 'expense', 'Monthly rent payments', true),
    (p_tenant_id, '6100', 'Salary & Wages', 'expense', 'Staff salaries and wages', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;
END;
$func$;

-- ============================================================
-- MONTHLY COGS WIZARD FUNCTION
-- Calculates COGS from stock counts and creates consumption entry
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_and_post_monthly_cogs(
  p_tenant_id UUID,
  p_restaurant_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_opening_inventory NUMERIC,
  p_closing_inventory NUMERIC,
  p_cogs_account_id UUID DEFAULT NULL,
  p_inventory_account_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_purchases_total NUMERIC;
  v_calculated_cogs NUMERIC;
  v_batch_id UUID;
  v_cogs_account UUID;
  v_inventory_account UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  -- Calculate total purchases for the period from inventory purchases
  SELECT COALESCE(SUM(p.total_cost), 0) INTO v_purchases_total
  FROM purchases p
  WHERE p.restaurant_id = p_restaurant_id
    AND p.received_at >= p_period_start
    AND p.received_at < p_period_end + INTERVAL '1 day'
    AND p.ledger_posted = true;
  
  -- Calculate COGS: Opening + Purchases - Closing
  v_calculated_cogs := p_opening_inventory + v_purchases_total - p_closing_inventory;
  
  -- Validate COGS is not negative
  IF v_calculated_cogs < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Calculated COGS is negative (%). Check inventory values: Opening (%) + Purchases (%) - Closing (%) = %', 
      v_calculated_cogs, p_opening_inventory, v_purchases_total, p_closing_inventory, v_calculated_cogs;
  END IF;
  
  -- Get or use provided COGS account (default 5000)
  v_cogs_account := COALESCE(p_cogs_account_id, (
    SELECT id FROM chart_of_accounts 
    WHERE tenant_id = p_tenant_id 
    AND account_code = '5000' 
    AND is_active = true 
    LIMIT 1
  ));
  
  IF v_cogs_account IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: No COGS account found. Create account 5000 (Cost of Food) in Chart of Accounts.';
  END IF;
  
  -- Get or use provided Inventory account (default 1200)
  v_inventory_account := COALESCE(p_inventory_account_id, (
    SELECT id FROM chart_of_accounts 
    WHERE tenant_id = p_tenant_id 
    AND account_code = '1200' 
    AND is_active = true 
    LIMIT 1
  ));
  
  IF v_inventory_account IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: No Inventory account found. Create account 1200 (Inventory - Food) in Chart of Accounts.';
  END IF;
  
  -- Create journal entry batch for consumption
  INSERT INTO journal_entry_batches (
    tenant_id, 
    batch_date, 
    description, 
    entry_type,
    journal_type,
    created_by, 
    is_posted, 
    posted_at, 
    posted_by
  ) VALUES (
    p_tenant_id,
    p_period_end,
    'Monthly COGS Recognition: ' || TO_CHAR(p_period_start, 'Mon DD') || ' - ' || TO_CHAR(p_period_end, 'Mon DD, YYYY'),
    'adjustment',
    'consumption',
    v_user_id,
    true,
    now(),
    v_user_id
  ) RETURNING id INTO v_batch_id;
  
  -- DR COGS (increase expense)
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit, description, 
    reference_type, reference_id, created_by, batch_id
  ) VALUES (
    p_tenant_id, v_cogs_account, p_period_end, v_calculated_cogs,
    'Monthly COGS: Opening ' || p_opening_inventory || ' + Purchases ' || v_purchases_total || ' - Closing ' || p_closing_inventory,
    'cogs_consumption', v_batch_id::text, v_user_id, v_batch_id
  );
  
  -- CR Inventory (decrease asset)
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, credit, description,
    reference_type, reference_id, created_by, batch_id
  ) VALUES (
    p_tenant_id, v_inventory_account, p_period_end, v_calculated_cogs,
    'Monthly COGS: Opening ' || p_opening_inventory || ' + Purchases ' || v_purchases_total || ' - Closing ' || p_closing_inventory,
    'cogs_consumption', v_batch_id::text, v_user_id, v_batch_id
  );
  
  RETURN v_batch_id;
END;
$func$;