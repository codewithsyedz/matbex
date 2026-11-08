
-- =============================================
-- HYBRID POS + INVENTORY + COA RESTAURANT SYSTEM
-- Phase 1: Shift Modes + Fresh Inventory Setup
-- =============================================

-- 1. Shift Mode Enum
DO $$ BEGIN
  CREATE TYPE shift_mode AS ENUM ('pos_per_sale', 'shift_summary');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. COGS Frequency Enum
DO $$ BEGIN
  CREATE TYPE cogs_frequency AS ENUM ('weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add shift_mode to shift_templates (defines which shifts use POS vs Summary)
ALTER TABLE shift_templates 
ADD COLUMN IF NOT EXISTS shift_mode public.shift_mode NOT NULL DEFAULT 'pos_per_sale';

-- 4. Add source tracking to shifts (how sales were recorded)
ALTER TABLE shifts
ADD COLUMN IF NOT EXISTS sales_mode public.shift_mode,
ADD COLUMN IF NOT EXISTS night_summary_posted boolean DEFAULT false;

-- 5. Enhance inventory_items with required fields for COGS discipline
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS cogs_frequency public.cogs_frequency NOT NULL DEFAULT 'monthly',
ADD COLUMN IF NOT EXISTS inventory_account_code text DEFAULT '1200',
ADD COLUMN IF NOT EXISTS cogs_account_code text DEFAULT '5000';

-- 6. Create inventory_categories lookup for auto-mapping
CREATE TABLE IF NOT EXISTS inventory_category_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) NOT NULL,
  category_name text NOT NULL,
  inventory_account_code text NOT NULL DEFAULT '1200',
  cogs_account_code text NOT NULL DEFAULT '5000',
  cogs_frequency public.cogs_frequency NOT NULL DEFAULT 'monthly',
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, category_name)
);

-- Enable RLS on inventory_category_mappings
ALTER TABLE inventory_category_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tenant inventory category mappings" ON inventory_category_mappings;
CREATE POLICY "Users can view own tenant inventory category mappings"
ON inventory_category_mappings FOR SELECT
USING (tenant_id IN (
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
));

DROP POLICY IF EXISTS "Users can manage own tenant inventory category mappings" ON inventory_category_mappings;
CREATE POLICY "Users can manage own tenant inventory category mappings"
ON inventory_category_mappings FOR ALL
USING (tenant_id IN (
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
));

-- 7. Night shift summary table
CREATE TABLE IF NOT EXISTS night_shift_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) NOT NULL,
  restaurant_id uuid REFERENCES restaurants(id) NOT NULL,
  shift_id uuid REFERENCES shifts(id) NOT NULL,
  business_date date NOT NULL,
  cash_collected numeric(12,2) NOT NULL DEFAULT 0,
  card_collected numeric(12,2) NOT NULL DEFAULT 0,
  net_sales numeric(12,2) NOT NULL DEFAULT 0,
  vat_amount numeric(12,2) DEFAULT 0,
  total_sales numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id) NOT NULL,
  created_at timestamptz DEFAULT now(),
  ledger_batch_id uuid REFERENCES journal_entry_batches(id),
  ledger_posted boolean DEFAULT false,
  UNIQUE(restaurant_id, business_date, shift_id)
);

-- Enable RLS on night_shift_summaries
ALTER TABLE night_shift_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own restaurant night summaries" ON night_shift_summaries;
CREATE POLICY "Users can view own restaurant night summaries"
ON night_shift_summaries FOR SELECT
USING (restaurant_id IN (
  SELECT restaurant_id FROM profiles WHERE id = auth.uid()
));

DROP POLICY IF EXISTS "Users can manage own restaurant night summaries" ON night_shift_summaries;
CREATE POLICY "Users can manage own restaurant night summaries"
ON night_shift_summaries FOR ALL
USING (restaurant_id IN (
  SELECT restaurant_id FROM profiles WHERE id = auth.uid()
));

-- 8. Weekly stocktake table
CREATE TABLE IF NOT EXISTS weekly_stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) NOT NULL,
  restaurant_id uuid REFERENCES restaurants(id) NOT NULL,
  stocktake_date date NOT NULL,
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'posted')),
  total_opening_value numeric(12,2) DEFAULT 0,
  total_purchases_value numeric(12,2) DEFAULT 0,
  total_closing_value numeric(12,2) DEFAULT 0,
  total_cogs numeric(12,2) DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id) NOT NULL,
  created_at timestamptz DEFAULT now(),
  posted_at timestamptz,
  posted_by uuid REFERENCES auth.users(id),
  ledger_batch_id uuid REFERENCES journal_entry_batches(id),
  UNIQUE(restaurant_id, week_end_date)
);

-- Weekly stocktake line items
CREATE TABLE IF NOT EXISTS weekly_stocktake_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid REFERENCES weekly_stocktakes(id) ON DELETE CASCADE NOT NULL,
  inventory_item_id uuid REFERENCES inventory_items(id) NOT NULL,
  item_name text NOT NULL,
  unit text NOT NULL,
  opening_qty numeric(12,3) DEFAULT 0,
  opening_value numeric(12,2) DEFAULT 0,
  purchases_qty numeric(12,3) DEFAULT 0,
  purchases_value numeric(12,2) DEFAULT 0,
  closing_qty numeric(12,3) NOT NULL,
  closing_value numeric(12,2) NOT NULL,
  consumption_qty numeric(12,3) GENERATED ALWAYS AS (opening_qty + purchases_qty - closing_qty) STORED,
  consumption_value numeric(12,2) GENERATED ALWAYS AS (opening_value + purchases_value - closing_value) STORED,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on weekly_stocktakes
ALTER TABLE weekly_stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_stocktake_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own restaurant weekly stocktakes" ON weekly_stocktakes;
CREATE POLICY "Users can view own restaurant weekly stocktakes"
ON weekly_stocktakes FOR SELECT
USING (restaurant_id IN (
  SELECT restaurant_id FROM profiles WHERE id = auth.uid()
));

DROP POLICY IF EXISTS "Users can manage own restaurant weekly stocktakes" ON weekly_stocktakes;
CREATE POLICY "Users can manage own restaurant weekly stocktakes"
ON weekly_stocktakes FOR ALL
USING (restaurant_id IN (
  SELECT restaurant_id FROM profiles WHERE id = auth.uid()
));

DROP POLICY IF EXISTS "Users can view weekly stocktake items" ON weekly_stocktake_items;
CREATE POLICY "Users can view weekly stocktake items"
ON weekly_stocktake_items FOR SELECT
USING (stocktake_id IN (
  SELECT id FROM weekly_stocktakes WHERE restaurant_id IN (
    SELECT restaurant_id FROM profiles WHERE id = auth.uid()
  )
));

DROP POLICY IF EXISTS "Users can manage weekly stocktake items" ON weekly_stocktake_items;
CREATE POLICY "Users can manage weekly stocktake items"
ON weekly_stocktake_items FOR ALL
USING (stocktake_id IN (
  SELECT id FROM weekly_stocktakes WHERE restaurant_id IN (
    SELECT restaurant_id FROM profiles WHERE id = auth.uid()
  )
));

-- 9. Simple waste tracking table
CREATE TABLE IF NOT EXISTS inventory_waste (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) NOT NULL,
  restaurant_id uuid REFERENCES restaurants(id) NOT NULL,
  waste_date date NOT NULL DEFAULT CURRENT_DATE,
  inventory_item_id uuid REFERENCES inventory_items(id),
  item_name text NOT NULL,
  quantity numeric(12,3) NOT NULL,
  unit text NOT NULL,
  value numeric(12,2) NOT NULL,
  reason text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) NOT NULL,
  created_at timestamptz DEFAULT now(),
  ledger_posted boolean DEFAULT false,
  ledger_transaction_id uuid REFERENCES account_transactions(id)
);

-- Enable RLS on inventory_waste
ALTER TABLE inventory_waste ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own restaurant waste" ON inventory_waste;
CREATE POLICY "Users can view own restaurant waste"
ON inventory_waste FOR SELECT
USING (restaurant_id IN (
  SELECT restaurant_id FROM profiles WHERE id = auth.uid()
));

DROP POLICY IF EXISTS "Users can manage own restaurant waste" ON inventory_waste;
CREATE POLICY "Users can manage own restaurant waste"
ON inventory_waste FOR ALL
USING (restaurant_id IN (
  SELECT restaurant_id FROM profiles WHERE id = auth.uid()
));

-- 10. Trigger: Block POS sales during night/summary shifts
CREATE OR REPLACE FUNCTION validate_sale_shift_mode()
RETURNS TRIGGER AS $$
DECLARE
  v_shift_mode public.shift_mode;
  v_template_mode public.shift_mode;
BEGIN
  -- Get shift mode from the shift
  SELECT s.sales_mode, st.shift_mode 
  INTO v_shift_mode, v_template_mode
  FROM shifts s
  LEFT JOIN shift_templates st ON s.shift_template_id = st.id
  WHERE s.id = NEW.shift_id;
  
  -- Use template mode if shift mode not set
  v_shift_mode := COALESCE(v_shift_mode, v_template_mode, 'pos_per_sale');
  
  -- Block per-sale entry during shift_summary mode
  IF v_shift_mode = 'shift_summary' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: This shift uses summary mode. Individual sales cannot be recorded. Use Night Shift Summary instead.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply trigger to sales_transactions table (the actual table name)
DROP TRIGGER IF EXISTS trg_validate_sale_shift_mode ON sales_transactions;
CREATE TRIGGER trg_validate_sale_shift_mode
BEFORE INSERT ON sales_transactions
FOR EACH ROW
EXECUTE FUNCTION validate_sale_shift_mode();

-- 11. Function to post night shift summary to ledger
CREATE OR REPLACE FUNCTION post_night_summary_to_ledger(p_summary_id uuid)
RETURNS uuid AS $$
DECLARE
  v_summary record;
  v_batch_id uuid;
  v_cash_account_id uuid;
  v_card_account_id uuid;
  v_revenue_account_id uuid;
  v_vat_account_id uuid;
BEGIN
  -- Get summary details
  SELECT * INTO v_summary FROM night_shift_summaries WHERE id = p_summary_id;
  
  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'Night shift summary not found';
  END IF;
  
  IF v_summary.ledger_posted THEN
    RAISE EXCEPTION 'Summary already posted to ledger';
  END IF;
  
  -- Get account IDs
  SELECT id INTO v_cash_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '1000' LIMIT 1;
  
  SELECT id INTO v_card_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '1020' LIMIT 1;
  
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '4000' LIMIT 1;
  
  SELECT id INTO v_vat_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_summary.tenant_id AND account_code = '2200' LIMIT 1;
  
  -- Create journal batch
  INSERT INTO journal_entry_batches (
    tenant_id, description, journal_type, reference_type, reference_id, status
  ) VALUES (
    v_summary.tenant_id,
    'Night Shift Summary - ' || v_summary.business_date,
    'sale',
    'night_summary',
    p_summary_id,
    'posted'
  ) RETURNING id INTO v_batch_id;
  
  -- Dr Cash
  IF v_summary.cash_collected > 0 AND v_cash_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, debit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_cash_account_id, v_batch_id, v_summary.business_date,
      v_summary.cash_collected, 'Night summary cash', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Dr Card Clearing
  IF v_summary.card_collected > 0 AND v_card_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, debit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_card_account_id, v_batch_id, v_summary.business_date,
      v_summary.card_collected, 'Night summary card', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Cr Revenue
  IF v_summary.net_sales > 0 AND v_revenue_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, credit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_revenue_account_id, v_batch_id, v_summary.business_date,
      v_summary.net_sales, 'Night summary revenue', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Cr VAT (if applicable)
  IF v_summary.vat_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO account_transactions (
      tenant_id, account_id, batch_id, transaction_date, credit,
      description, reference_type, reference_id
    ) VALUES (
      v_summary.tenant_id, v_vat_account_id, v_batch_id, v_summary.business_date,
      v_summary.vat_amount, 'Night summary VAT', 'night_summary', p_summary_id::text
    );
  END IF;
  
  -- Mark as posted
  UPDATE night_shift_summaries 
  SET ledger_posted = true, ledger_batch_id = v_batch_id
  WHERE id = p_summary_id;
  
  RETURN v_batch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12. Function to post waste to ledger
CREATE OR REPLACE FUNCTION post_waste_to_ledger(p_waste_id uuid)
RETURNS uuid AS $$
DECLARE
  v_waste record;
  v_waste_account_id uuid;
  v_inventory_account_id uuid;
  v_transaction_id uuid;
BEGIN
  SELECT * INTO v_waste FROM inventory_waste WHERE id = p_waste_id;
  
  IF v_waste IS NULL THEN
    RAISE EXCEPTION 'Waste record not found';
  END IF;
  
  IF v_waste.ledger_posted THEN
    RAISE EXCEPTION 'Waste already posted to ledger';
  END IF;
  
  -- Get waste account (6100)
  SELECT id INTO v_waste_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_waste.tenant_id AND account_code = '6100' LIMIT 1;
  
  -- Get inventory account (default 1200)
  SELECT id INTO v_inventory_account_id FROM chart_of_accounts 
  WHERE tenant_id = v_waste.tenant_id AND account_code = '1200' LIMIT 1;
  
  IF v_waste_account_id IS NULL OR v_inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Required accounts (6100 Waste, 1200 Inventory) not found in CoA';
  END IF;
  
  -- Dr Waste
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, debit,
    description, reference_type, reference_id
  ) VALUES (
    v_waste.tenant_id, v_waste_account_id, v_waste.waste_date,
    v_waste.value, 'Waste: ' || v_waste.item_name || ' - ' || v_waste.reason,
    'waste', p_waste_id::text
  ) RETURNING id INTO v_transaction_id;
  
  -- Cr Inventory
  INSERT INTO account_transactions (
    tenant_id, account_id, transaction_date, credit,
    description, reference_type, reference_id
  ) VALUES (
    v_waste.tenant_id, v_inventory_account_id, v_waste.waste_date,
    v_waste.value, 'Waste: ' || v_waste.item_name || ' - ' || v_waste.reason,
    'waste', p_waste_id::text
  );
  
  -- Mark as posted
  UPDATE inventory_waste 
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_waste_id;
  
  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Seed default category mappings function (per tenant)
CREATE OR REPLACE FUNCTION seed_inventory_category_mappings(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO inventory_category_mappings (tenant_id, category_name, inventory_account_code, cogs_account_code, cogs_frequency)
  VALUES 
    (p_tenant_id, 'Chicken', '1200', '5000', 'weekly'),
    (p_tenant_id, 'Vegetables', '1200', '5000', 'weekly'),
    (p_tenant_id, 'Oil', '1200', '5000', 'weekly'),
    (p_tenant_id, 'Milk', '1200', '5000', 'weekly'),
    (p_tenant_id, 'Dry Food', '1200', '5000', 'monthly'),
    (p_tenant_id, 'Rice', '1200', '5000', 'monthly'),
    (p_tenant_id, 'Flour', '1200', '5000', 'monthly'),
    (p_tenant_id, 'Spices', '1200', '5000', 'monthly'),
    (p_tenant_id, 'Beverages', '1210', '5010', 'monthly'),
    (p_tenant_id, 'Packaging', '1220', '5020', 'monthly')
  ON CONFLICT (tenant_id, category_name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. Seed standard COA accounts for tenant
CREATE OR REPLACE FUNCTION ensure_standard_coa_for_hybrid_pos(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  -- Assets
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  VALUES 
    (p_tenant_id, '1000', 'Cash', 'asset', true),
    (p_tenant_id, '1010', 'Bank', 'asset', true),
    (p_tenant_id, '1020', 'Card Clearing', 'asset', true),
    (p_tenant_id, '1200', 'Inventory - Food', 'asset', true),
    (p_tenant_id, '1210', 'Inventory - Beverages', 'asset', true),
    (p_tenant_id, '1220', 'Inventory - Packaging', 'asset', true)
  ON CONFLICT DO NOTHING;
  
  -- Liabilities
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  VALUES 
    (p_tenant_id, '2100', 'Accounts Payable - Suppliers', 'liability', true),
    (p_tenant_id, '2200', 'VAT Payable', 'liability', true)
  ON CONFLICT DO NOTHING;
  
  -- Revenue
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  VALUES 
    (p_tenant_id, '4000', 'Sales Revenue', 'revenue', true)
  ON CONFLICT DO NOTHING;
  
  -- COGS
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  VALUES 
    (p_tenant_id, '5000', 'Cost of Food', 'cogs', true),
    (p_tenant_id, '5010', 'Cost of Beverages', 'cogs', true),
    (p_tenant_id, '5020', 'Cost of Packaging', 'cogs', true)
  ON CONFLICT DO NOTHING;
  
  -- Expenses
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account)
  VALUES 
    (p_tenant_id, '6100', 'Inventory Waste / Shrinkage', 'expense', true)
  ON CONFLICT DO NOTHING;
  
  -- Seed category mappings
  PERFORM seed_inventory_category_mappings(p_tenant_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
