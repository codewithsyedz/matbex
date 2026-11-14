-- ================================================================
-- PHASE 2: Seed COA + Sample Inventory + Waste Ledger Integration
-- ================================================================

-- 1. Create function to seed standard COA for hybrid POS system
CREATE OR REPLACE FUNCTION seed_hybrid_pos_coa(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  -- Assets
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES 
    (p_tenant_id, '1000', 'Cash', 'asset', 'Cash on hand', true),
    (p_tenant_id, '1010', 'Bank', 'asset', 'Bank accounts', true),
    (p_tenant_id, '1020', 'Card Clearing', 'asset', 'Card payment clearing account', true),
    (p_tenant_id, '1200', 'Inventory - Food', 'asset', 'Food inventory', true),
    (p_tenant_id, '1210', 'Inventory - Beverages', 'asset', 'Beverage inventory', true),
    (p_tenant_id, '1220', 'Inventory - Packaging', 'asset', 'Packaging supplies inventory', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- Liabilities
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES 
    (p_tenant_id, '2100', 'Accounts Payable - Suppliers', 'liability', 'Amounts owed to suppliers', true),
    (p_tenant_id, '2200', 'VAT Payable', 'liability', 'VAT collected from sales', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- Revenue
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES 
    (p_tenant_id, '4000', 'Sales Revenue', 'revenue', 'Revenue from sales', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- COGS (Cost of Goods Sold)
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES 
    (p_tenant_id, '5000', 'Cost of Food', 'cogs', 'Cost of food sold', true),
    (p_tenant_id, '5010', 'Cost of Beverages', 'cogs', 'Cost of beverages sold', true),
    (p_tenant_id, '5020', 'Cost of Packaging', 'cogs', 'Cost of packaging materials', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  -- Expenses
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
  VALUES 
    (p_tenant_id, '6100', 'Inventory Waste / Shrinkage', 'expense', 'Waste, spoilage, and shrinkage losses', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create function to seed sample inventory items for a restaurant
CREATE OR REPLACE FUNCTION seed_sample_inventory_items(p_restaurant_id uuid)
RETURNS void AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Get tenant_id from restaurant
  SELECT tenant_id INTO v_tenant_id FROM restaurants WHERE id = p_restaurant_id;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found or has no tenant';
  END IF;

  -- First seed the COA for this tenant
  PERFORM seed_hybrid_pos_coa(v_tenant_id);
  
  -- Seed category mappings
  PERFORM seed_inventory_category_mappings(v_tenant_id);

  -- Insert sample inventory items
  INSERT INTO inventory_items (restaurant_id, name, current_stock, unit, unit_cost, vat_percentage, reorder_level, cogs_frequency, inventory_account_code, cogs_account_code)
  VALUES 
    -- Weekly items (fresh produce)
    (p_restaurant_id, 'Whole Chicken', 50, 'kg', 18.00, 15, 15, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Chicken Breast', 30, 'kg', 28.00, 15, 10, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Mixed Vegetables', 20, 'kg', 8.00, 15, 8, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Tomatoes', 25, 'kg', 5.00, 15, 10, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Onions', 30, 'kg', 3.00, 15, 12, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Cooking Oil', 40, 'L', 12.00, 15, 15, 'weekly', '1200', '5000'),
    (p_restaurant_id, 'Fresh Milk', 20, 'L', 6.00, 15, 10, 'weekly', '1200', '5000'),
    
    -- Monthly items (dry goods)
    (p_restaurant_id, 'Basmati Rice', 100, 'kg', 8.00, 15, 25, 'monthly', '1200', '5000'),
    (p_restaurant_id, 'White Flour', 50, 'kg', 4.00, 15, 15, 'monthly', '1200', '5000'),
    (p_restaurant_id, 'Mixed Spices', 10, 'kg', 45.00, 15, 3, 'monthly', '1200', '5000'),
    (p_restaurant_id, 'Salt', 20, 'kg', 2.00, 15, 5, 'monthly', '1200', '5000'),
    
    -- Beverages (monthly)
    (p_restaurant_id, 'Soft Drinks Carton', 30, 'carton', 35.00, 15, 10, 'monthly', '1210', '5010'),
    (p_restaurant_id, 'Bottled Water', 50, 'pack', 8.00, 15, 15, 'monthly', '1210', '5010'),
    (p_restaurant_id, 'Tea Bags', 20, 'box', 15.00, 15, 5, 'monthly', '1210', '5010'),
    
    -- Packaging (monthly)
    (p_restaurant_id, 'Takeaway Containers', 500, 'pcs', 0.50, 15, 150, 'monthly', '1220', '5020'),
    (p_restaurant_id, 'Paper Bags', 300, 'pcs', 0.25, 15, 100, 'monthly', '1220', '5020'),
    (p_restaurant_id, 'Plastic Forks/Spoons', 400, 'pcs', 0.10, 15, 150, 'monthly', '1220', '5020')
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Add ledger posting columns to waste_records if not present
ALTER TABLE waste_records
ADD COLUMN IF NOT EXISTS ledger_posted boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ledger_transaction_id uuid REFERENCES account_transactions(id);

-- 4. Create function to post waste to ledger
-- DR 6100 Inventory Waste, CR Inventory (by category)
CREATE OR REPLACE FUNCTION post_waste_to_ledger(
  p_waste_id uuid,
  p_inventory_account_code text DEFAULT '1200'
)
RETURNS uuid AS $$
DECLARE
  v_waste waste_records%ROWTYPE;
  v_item inventory_items%ROWTYPE;
  v_restaurant restaurants%ROWTYPE;
  v_tenant_id uuid;
  v_expense_account_id uuid;
  v_inventory_account_id uuid;
  v_batch_id uuid;
  v_transaction_id uuid;
BEGIN
  -- Get waste record
  SELECT * INTO v_waste FROM waste_records WHERE id = p_waste_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Waste record not found';
  END IF;

  IF v_waste.ledger_posted THEN
    RAISE EXCEPTION 'Waste already posted to ledger';
  END IF;

  -- Get inventory item
  SELECT * INTO v_item FROM inventory_items WHERE id = v_waste.inventory_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  -- Get restaurant and tenant
  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_waste.restaurant_id;
  v_tenant_id := v_restaurant.tenant_id;

  -- Get account IDs
  SELECT id INTO v_expense_account_id 
  FROM chart_of_accounts 
  WHERE tenant_id = v_tenant_id AND account_code = '6100';

  SELECT id INTO v_inventory_account_id 
  FROM chart_of_accounts 
  WHERE tenant_id = v_tenant_id AND account_code = COALESCE(v_item.inventory_account_code, p_inventory_account_code);

  IF v_expense_account_id IS NULL OR v_inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts not found. Please seed COA first.';
  END IF;

  -- Create journal entry batch
  INSERT INTO journal_entry_batches (
    tenant_id,
    restaurant_id,
    description,
    entry_type,
    journal_type,
    batch_date,
    is_posted,
    total_amount
  ) VALUES (
    v_tenant_id,
    v_waste.restaurant_id,
    'Waste: ' || v_item.name || ' - ' || v_waste.waste_reason,
    'adjustment',
    'waste',
    v_waste.waste_date,
    true,
    v_waste.total_cost
  ) RETURNING id INTO v_batch_id;

  -- DR 6100 Inventory Waste (increase expense)
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    batch_id,
    transaction_date,
    debit,
    description,
    reference_type,
    reference_id
  ) VALUES (
    v_tenant_id,
    v_expense_account_id,
    v_batch_id,
    v_waste.waste_date,
    v_waste.total_cost,
    'Waste: ' || v_item.name,
    'waste',
    p_waste_id
  ) RETURNING id INTO v_transaction_id;

  -- CR Inventory (decrease asset)
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    batch_id,
    transaction_date,
    credit,
    description,
    reference_type,
    reference_id
  ) VALUES (
    v_tenant_id,
    v_inventory_account_id,
    v_batch_id,
    v_waste.waste_date,
    v_waste.total_cost,
    'Waste: ' || v_item.name,
    'waste',
    p_waste_id
  );

  -- Mark waste as posted
  UPDATE waste_records 
  SET ledger_posted = true, ledger_transaction_id = v_transaction_id
  WHERE id = p_waste_id;

  -- Update account balances
  UPDATE chart_of_accounts 
  SET balance = COALESCE(balance, 0) + v_waste.total_cost
  WHERE id = v_expense_account_id;

  UPDATE chart_of_accounts 
  SET balance = COALESCE(balance, 0) - v_waste.total_cost
  WHERE id = v_inventory_account_id;

  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create trigger to auto-post waste to ledger
CREATE OR REPLACE FUNCTION auto_post_waste_to_ledger()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-post waste to ledger after insert
  PERFORM post_waste_to_ledger(NEW.id);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the insert
    RAISE WARNING 'Failed to auto-post waste to ledger: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_auto_post_waste_to_ledger ON waste_records;
CREATE TRIGGER trg_auto_post_waste_to_ledger
  AFTER INSERT ON waste_records
  FOR EACH ROW
  EXECUTE FUNCTION auto_post_waste_to_ledger();

-- 6. Grant execute permissions
GRANT EXECUTE ON FUNCTION seed_hybrid_pos_coa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION seed_sample_inventory_items(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION post_waste_to_ledger(uuid, text) TO authenticated;