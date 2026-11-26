-- ============================================================
-- WEEKLY COGS WIZARD: Database Functions
-- ============================================================

-- Function to get weekly items with opening stock and purchases
CREATE OR REPLACE FUNCTION get_weekly_cogs_items(
  p_restaurant_id UUID,
  p_week_start DATE,
  p_week_end DATE
)
RETURNS TABLE (
  item_id UUID,
  item_name TEXT,
  unit TEXT,
  unit_cost NUMERIC,
  opening_qty NUMERIC,
  opening_value NUMERIC,
  purchases_qty NUMERIC,
  purchases_value NUMERIC,
  current_stock NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.id AS item_id,
    i.name AS item_name,
    i.unit,
    i.unit_cost,
    -- Opening stock: current stock + usage during period - purchases during period
    COALESCE(
      i.current_stock + 
      COALESCE((SELECT SUM(u.quantity_used) FROM inventory_usage u 
                WHERE u.inventory_item_id = i.id 
                AND u.usage_date BETWEEN p_week_start AND p_week_end), 0) -
      COALESCE((SELECT SUM(p.quantity_received) FROM purchases p 
                WHERE p.inventory_item_id = i.id 
                AND p.received_at::date BETWEEN p_week_start AND p_week_end), 0),
      0
    )::NUMERIC AS opening_qty,
    -- Opening value
    COALESCE(
      (i.current_stock + 
       COALESCE((SELECT SUM(u.quantity_used) FROM inventory_usage u 
                 WHERE u.inventory_item_id = i.id 
                 AND u.usage_date BETWEEN p_week_start AND p_week_end), 0) -
       COALESCE((SELECT SUM(p.quantity_received) FROM purchases p 
                 WHERE p.inventory_item_id = i.id 
                 AND p.received_at::date BETWEEN p_week_start AND p_week_end), 0)) * i.unit_cost,
      0
    )::NUMERIC AS opening_value,
    -- Purchases during week
    COALESCE((SELECT SUM(p.quantity_received) FROM purchases p 
              WHERE p.inventory_item_id = i.id 
              AND p.received_at::date BETWEEN p_week_start AND p_week_end), 0)::NUMERIC AS purchases_qty,
    COALESCE((SELECT SUM(p.total_cost) FROM purchases p 
              WHERE p.inventory_item_id = i.id 
              AND p.received_at::date BETWEEN p_week_start AND p_week_end), 0)::NUMERIC AS purchases_value,
    i.current_stock
  FROM inventory_items i
  WHERE i.restaurant_id = p_restaurant_id
    AND i.cogs_frequency = 'weekly'
  ORDER BY i.name;
END;
$$;

-- Function to create and post weekly COGS
CREATE OR REPLACE FUNCTION post_weekly_cogs_to_ledger(
  p_stocktake_id UUID,
  p_posted_by UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stocktake RECORD;
  v_tenant_id UUID;
  v_batch_id UUID;
  v_cogs_account_id UUID;
  v_inventory_account_id UUID;
  v_item RECORD;
  v_total_cogs NUMERIC := 0;
BEGIN
  -- Get stocktake details
  SELECT ws.*, r.tenant_id 
  INTO v_stocktake
  FROM weekly_stocktakes ws
  JOIN restaurants r ON r.id = ws.restaurant_id
  WHERE ws.id = p_stocktake_id;
  
  IF v_stocktake IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Stocktake not found';
  END IF;
  
  IF v_stocktake.status = 'posted' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Stocktake already posted to ledger';
  END IF;
  
  v_tenant_id := v_stocktake.tenant_id;
  
  -- Get COGS account (5000 for Food)
  SELECT id INTO v_cogs_account_id
  FROM chart_of_accounts
  WHERE tenant_id = v_tenant_id
    AND account_code = '5000'
    AND is_active = true;
    
  IF v_cogs_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: COGS account 5000 not found. Please ensure COA is properly seeded.';
  END IF;
  
  -- Get Inventory account (1200 for Food)
  SELECT id INTO v_inventory_account_id
  FROM chart_of_accounts
  WHERE tenant_id = v_tenant_id
    AND account_code = '1200'
    AND is_active = true;
    
  IF v_inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Inventory account 1200 not found. Please ensure COA is properly seeded.';
  END IF;
  
  -- Calculate total COGS from stocktake items
  SELECT COALESCE(SUM(consumption_value), 0) INTO v_total_cogs
  FROM weekly_stocktake_items
  WHERE stocktake_id = p_stocktake_id;
  
  IF v_total_cogs <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: No consumption to post. Total COGS must be greater than zero.';
  END IF;
  
  -- Create journal entry batch
  INSERT INTO journal_entry_batches (
    tenant_id,
    entry_type,
    source_type,
    source_id,
    description,
    total_debit,
    total_credit,
    status,
    created_by
  ) VALUES (
    v_tenant_id,
    'cogs',
    'weekly_stocktake',
    p_stocktake_id,
    'Weekly COGS: ' || v_stocktake.week_start_date || ' to ' || v_stocktake.week_end_date,
    v_total_cogs,
    v_total_cogs,
    'posted',
    p_posted_by
  )
  RETURNING id INTO v_batch_id;
  
  -- DR 5000 Cost of Food (COGS expense)
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    batch_id,
    transaction_date,
    debit,
    description,
    reference_type,
    reference_id,
    created_by
  ) VALUES (
    v_tenant_id,
    v_cogs_account_id,
    v_batch_id,
    v_stocktake.stocktake_date,
    v_total_cogs,
    'Weekly COGS consumption: Week ' || v_stocktake.week_start_date || ' - ' || v_stocktake.week_end_date,
    'weekly_stocktake',
    p_stocktake_id,
    p_posted_by
  );
  
  -- CR 1200 Inventory - Food (reduce asset)
  INSERT INTO account_transactions (
    tenant_id,
    account_id,
    batch_id,
    transaction_date,
    credit,
    description,
    reference_type,
    reference_id,
    created_by
  ) VALUES (
    v_tenant_id,
    v_inventory_account_id,
    v_batch_id,
    v_stocktake.stocktake_date,
    v_total_cogs,
    'Weekly COGS consumption: Week ' || v_stocktake.week_start_date || ' - ' || v_stocktake.week_end_date,
    'weekly_stocktake',
    p_stocktake_id,
    p_posted_by
  );
  
  -- Update account balances
  UPDATE chart_of_accounts
  SET balance = COALESCE(balance, 0) + v_total_cogs
  WHERE id = v_cogs_account_id;
  
  UPDATE chart_of_accounts
  SET balance = COALESCE(balance, 0) - v_total_cogs
  WHERE id = v_inventory_account_id;
  
  -- Update stocktake status
  UPDATE weekly_stocktakes
  SET status = 'posted',
      posted_at = now(),
      posted_by = p_posted_by,
      ledger_batch_id = v_batch_id,
      total_cogs = v_total_cogs
  WHERE id = p_stocktake_id;
  
  -- Update inventory item current stock from closing values
  FOR v_item IN 
    SELECT wsi.inventory_item_id, wsi.closing_qty
    FROM weekly_stocktake_items wsi
    WHERE wsi.stocktake_id = p_stocktake_id
  LOOP
    UPDATE inventory_items
    SET current_stock = v_item.closing_qty,
        updated_at = now()
    WHERE id = v_item.inventory_item_id;
  END LOOP;
  
  RETURN v_batch_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_weekly_cogs_items TO authenticated;
GRANT EXECUTE ON FUNCTION post_weekly_cogs_to_ledger TO authenticated;