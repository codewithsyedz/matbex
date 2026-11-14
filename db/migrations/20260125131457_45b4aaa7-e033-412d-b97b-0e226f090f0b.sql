-- Epic 5: COGS & Inventory Discipline
-- Enforces COGS account mapping for purchases and auto-posts from inventory consumption

-- 1. Add COGS account mapping to inventory_usage for auto-posting
ALTER TABLE public.inventory_usage 
ADD COLUMN IF NOT EXISTS cogs_account_id UUID REFERENCES public.chart_of_accounts(id),
ADD COLUMN IF NOT EXISTS ledger_posted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ledger_transaction_id UUID REFERENCES public.account_transactions(id);

-- 2. Add COGS account mapping to cogs_purchases table
ALTER TABLE public.cogs_purchases
ADD COLUMN IF NOT EXISTS cogs_account_id UUID REFERENCES public.chart_of_accounts(id),
ADD COLUMN IF NOT EXISTS ledger_posted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ledger_transaction_id UUID REFERENCES public.account_transactions(id);

-- 3. Add default COGS account to inventory items for auto-mapping
ALTER TABLE public.inventory_items
ADD COLUMN IF NOT EXISTS default_cogs_account_id UUID REFERENCES public.chart_of_accounts(id);

-- 4. Create trigger to block negative inventory
CREATE OR REPLACE FUNCTION public.validate_inventory_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_stock NUMERIC;
  v_item_name TEXT;
BEGIN
  -- Get current stock
  SELECT current_stock, name INTO v_current_stock, v_item_name
  FROM public.inventory_items
  WHERE id = NEW.inventory_item_id;
  
  -- Validate stock availability
  IF v_current_stock < NEW.quantity_used THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Insufficient stock for "%" - Available: %, Requested: %. Negative inventory is not allowed.', 
      v_item_name, v_current_stock, NEW.quantity_used;
  END IF;
  
  -- Validate consumption date is provided and not in future
  IF NEW.usage_date IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Consumption date is required for inventory usage entries.';
  END IF;
  
  IF NEW.usage_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Consumption date cannot be in the future.';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_inventory_stock ON public.inventory_usage;
CREATE TRIGGER trigger_validate_inventory_stock
BEFORE INSERT ON public.inventory_usage
FOR EACH ROW
EXECUTE FUNCTION public.validate_inventory_stock();

-- 5. Create trigger to auto-deduct inventory on usage insert
CREATE OR REPLACE FUNCTION public.auto_deduct_inventory_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.inventory_items
  SET current_stock = current_stock - NEW.quantity_used,
      updated_at = now()
  WHERE id = NEW.inventory_item_id;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_deduct_inventory ON public.inventory_usage;
CREATE TRIGGER trigger_auto_deduct_inventory
AFTER INSERT ON public.inventory_usage
FOR EACH ROW
EXECUTE FUNCTION public.auto_deduct_inventory_stock();

-- 6. Create function to validate COGS account type for purchases
CREATE OR REPLACE FUNCTION public.validate_cogs_account_mapping()
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
  -- Skip if no account mapped yet
  IF NEW.cogs_account_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get account type
  SELECT account_type, account_name, account_code
  INTO v_account_type, v_account_name, v_account_code
  FROM public.chart_of_accounts
  WHERE id = NEW.cogs_account_id;
  
  -- Validate it's a COGS account (5000-5999)
  IF v_account_type != 'cogs' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Purchase entries must be mapped to COGS accounts (5000-5999), not % accounts. Account "% - %" is type "%". Use COGS for inventory purchases to protect gross margin accuracy.', 
      v_account_type, v_account_code, v_account_name, v_account_type;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_cogs_account_purchases ON public.cogs_purchases;
CREATE TRIGGER trigger_validate_cogs_account_purchases
BEFORE INSERT OR UPDATE ON public.cogs_purchases
FOR EACH ROW
EXECUTE FUNCTION public.validate_cogs_account_mapping();

DROP TRIGGER IF EXISTS trigger_validate_cogs_account_usage ON public.inventory_usage;
CREATE TRIGGER trigger_validate_cogs_account_usage
BEFORE INSERT OR UPDATE ON public.inventory_usage
FOR EACH ROW
WHEN (NEW.cogs_account_id IS NOT NULL)
EXECUTE FUNCTION public.validate_cogs_account_mapping();

-- 7. Create function to auto-post inventory usage to COGS ledger
CREATE OR REPLACE FUNCTION public.post_inventory_usage_to_cogs(
  p_usage_id UUID,
  p_cogs_account_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_usage RECORD;
  v_tenant_id UUID;
  v_transaction_id UUID;
BEGIN
  -- Get usage details
  SELECT iu.*, ii.name as item_name, r.tenant_id
  INTO v_usage
  FROM public.inventory_usage iu
  JOIN public.inventory_items ii ON iu.inventory_item_id = ii.id
  JOIN public.restaurants r ON iu.restaurant_id = r.id
  WHERE iu.id = p_usage_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory usage entry not found';
  END IF;
  
  IF v_usage.ledger_posted THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: This usage entry has already been posted to the ledger';
  END IF;
  
  v_tenant_id := v_usage.tenant_id;
  
  -- Create COGS transaction (debit the COGS account)
  INSERT INTO public.account_transactions (
    tenant_id,
    account_id,
    transaction_date,
    debit,
    credit,
    description,
    reference_type,
    reference_id,
    created_by
  ) VALUES (
    v_tenant_id,
    p_cogs_account_id,
    v_usage.usage_date,
    v_usage.total_cost,
    NULL,
    'COGS - ' || v_usage.item_name || ' (' || v_usage.quantity_used || ' units)',
    'cogs_consumption',
    p_usage_id,
    auth.uid()
  )
  RETURNING id INTO v_transaction_id;
  
  -- Update usage as posted
  UPDATE public.inventory_usage
  SET 
    ledger_posted = TRUE,
    ledger_transaction_id = v_transaction_id,
    cogs_account_id = p_cogs_account_id
  WHERE id = p_usage_id;
  
  RETURN v_transaction_id;
END;
$$;

-- 8. Create function to post purchase directly to COGS
CREATE OR REPLACE FUNCTION public.post_purchase_to_cogs(
  p_purchase_id UUID,
  p_cogs_account_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_purchase RECORD;
  v_submission RECORD;
  v_transaction_id UUID;
BEGIN
  -- Get purchase details
  SELECT cp.*, dcs.restaurant_id
  INTO v_purchase
  FROM public.cogs_purchases cp
  JOIN public.daily_cogs_submissions dcs ON cp.submission_id = dcs.id
  WHERE cp.id = p_purchase_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase entry not found';
  END IF;
  
  IF v_purchase.ledger_posted THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: This purchase has already been posted to the ledger';
  END IF;
  
  -- Get tenant_id from restaurant
  SELECT tenant_id INTO v_submission.tenant_id
  FROM public.restaurants WHERE id = v_purchase.restaurant_id;
  
  -- Create COGS transaction (debit the COGS account)
  INSERT INTO public.account_transactions (
    tenant_id,
    account_id,
    transaction_date,
    debit,
    credit,
    description,
    reference_type,
    reference_id,
    created_by
  ) VALUES (
    v_submission.tenant_id,
    p_cogs_account_id,
    CURRENT_DATE,
    v_purchase.amount,
    NULL,
    'COGS Purchase - ' || v_purchase.item_type || COALESCE(' (' || v_purchase.supplier_name || ')', ''),
    'cogs_purchase',
    p_purchase_id,
    auth.uid()
  )
  RETURNING id INTO v_transaction_id;
  
  -- Update purchase as posted
  UPDATE public.cogs_purchases
  SET 
    ledger_posted = TRUE,
    ledger_transaction_id = v_transaction_id,
    cogs_account_id = p_cogs_account_id
  WHERE id = p_purchase_id;
  
  RETURN v_transaction_id;
END;
$$;

-- 9. Update the account type validation to include COGS consumption reference type
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
  ELSIF NEW.reference_type IN ('cogs_consumption', 'cogs_purchase') THEN
    IF v_account_type != 'cogs' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: COGS transactions must post to COGS accounts (5000-5999). Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 10. Add RLS policies for the new columns
-- (Existing RLS policies on inventory_usage and cogs_purchases should cover these)