-- cogs_posting_access_and_stock_count_true_up
--
-- Found in the cost-of-goods review (2026-11-14):
-- 1. Four SECURITY DEFINER posting functions had no access check and were executable by any
--    signed-in user: calculate_and_post_monthly_cogs (takes any tenant id), post_purchase_to_cogs,
--    post_inventory_usage_to_cogs and reconcile_provisional_cogs (take a record id). Each now
--    requires membership of the record's business and the right to post journal entries
--    (system callers with no user - scheduled jobs - pass as before).
-- 2. No cost of goods was ever booked for a business without recipes (Smoke Grill: 353,947 SAR
--    in 1200 Food Inventory, nothing expensed). post_stock_count_true_up posts the month-end
--    stock count against the inventory account's book value.

CREATE OR REPLACE FUNCTION public.calculate_and_post_monthly_cogs(p_tenant_id uuid, p_restaurant_id uuid, p_period_start date, p_period_end date, p_opening_inventory numeric, p_closing_inventory numeric, p_cogs_account_id uuid DEFAULT NULL::uuid, p_inventory_account_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchases_total NUMERIC;
  v_calculated_cogs NUMERIC;
  v_batch_id UUID;
  v_cogs_account UUID;
  v_inventory_account UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  -- Access: a member of this business with the right to post journal entries (system callers,
  -- with no user, are the scheduled jobs).
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_tenant_access(p_tenant_id);
    PERFORM public.assert_restaurant_access(p_restaurant_id);
    IF NOT public.can_post_journal_entries(p_tenant_id) THEN
      RAISE EXCEPTION 'Not allowed to post cost of goods for this business' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM restaurants WHERE id = p_restaurant_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Restaurant does not belong to this business' USING ERRCODE = '42501';
  END IF;

  
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
$function$;

CREATE OR REPLACE FUNCTION public.post_inventory_usage_to_cogs(p_usage_id uuid, p_cogs_account_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Access: a member of this business with the right to post journal entries (system callers,
  -- with no user, are the scheduled jobs).
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_tenant_access(v_tenant_id);
    PERFORM public.assert_restaurant_access(v_usage.restaurant_id);
    IF NOT public.can_post_journal_entries(v_tenant_id) THEN
      RAISE EXCEPTION 'Not allowed to post cost of goods for this business' USING ERRCODE = '42501';
    END IF;
  END IF;

  
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
$function$;

CREATE OR REPLACE FUNCTION public.post_purchase_to_cogs(p_purchase_id uuid, p_cogs_account_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Access: a member of this business with the right to post journal entries (system callers,
  -- with no user, are the scheduled jobs).
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_tenant_access(v_submission.tenant_id);
    PERFORM public.assert_restaurant_access(v_purchase.restaurant_id);
    IF NOT public.can_post_journal_entries(v_submission.tenant_id) THEN
      RAISE EXCEPTION 'Not allowed to post cost of goods for this business' USING ERRCODE = '42501';
    END IF;
  END IF;

  
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
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_provisional_cogs(_stocktake_id uuid, _kind text DEFAULT 'weekly'::text, _correct_wac boolean DEFAULT false, _reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid;
  v_existing uuid;
  v_tenant_id uuid;
  v_restaurant_id uuid;
  v_period_start date;
  v_period_end date;
  v_batch_id uuid;
  v_total_prov numeric(14,4) := 0;
  v_total_act  numeric(14,4) := 0;
  v_total_var  numeric(14,4) := 0;
  v_items_count int := 0;
  v_items_var int := 0;
  v_item record;
  v_prov numeric(14,4);
  v_actual numeric(14,4);
  v_variance numeric(14,4);
  v_inv record;
  v_inv_acct_code text;
  v_cogs_acct_code text;
  v_inv_acct_id uuid;
  v_cogs_acct_id uuid;
  v_new_wac numeric(14,6);
BEGIN
  SELECT id INTO v_existing FROM public.cogs_trueup_runs
   WHERE stocktake_id = _stocktake_id AND stocktake_kind = _kind;
  IF FOUND THEN RETURN v_existing; END IF;

  IF _kind = 'weekly' THEN
    SELECT tenant_id, restaurant_id, week_start_date, COALESCE(week_end_date, stocktake_date)
      INTO v_tenant_id, v_restaurant_id, v_period_start, v_period_end
    FROM public.weekly_stocktakes WHERE id = _stocktake_id;
  ELSIF _kind = 'daily' THEN
    SELECT NULL::uuid, restaurant_id, NULL::date, stocktake_date
      INTO v_tenant_id, v_restaurant_id, v_period_start, v_period_end
    FROM public.stocktakes WHERE id = _stocktake_id;
    IF v_restaurant_id IS NOT NULL THEN
      SELECT tenant_id INTO v_tenant_id FROM public.restaurants WHERE id = v_restaurant_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid stocktake kind: %', _kind;
  END IF;

  IF v_restaurant_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Stocktake % not found', _stocktake_id;
  END IF;
  -- Access: a member of this business with the right to post journal entries (system callers,
  -- with no user, are the scheduled jobs).
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_tenant_access(v_tenant_id);
    PERFORM public.assert_restaurant_access(v_restaurant_id);
    IF NOT public.can_post_journal_entries(v_tenant_id) THEN
      RAISE EXCEPTION 'Not allowed to post cost of goods for this business' USING ERRCODE = '42501';
    END IF;
  END IF;


  INSERT INTO public.cogs_trueup_runs
    (tenant_id, restaurant_id, stocktake_id, stocktake_kind,
     period_start, period_end, wac_corrected, reason, created_by)
  VALUES
    (v_tenant_id, v_restaurant_id, _stocktake_id, _kind,
     v_period_start, v_period_end, _correct_wac, _reason, auth.uid())
  RETURNING id INTO v_run_id;

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number,
     entry_type, journal_type, is_posted, posted_at)
  VALUES
    (v_tenant_id, v_period_end,
     'COGS true-up for ' || _kind || ' stocktake ' || _stocktake_id::text,
     'TRUEUP-' || v_run_id::text,
     'cogs_trueup', 'cogs_trueup', true, now())
  RETURNING id INTO v_batch_id;

  UPDATE public.cogs_trueup_runs SET ledger_batch_id = v_batch_id WHERE id = v_run_id;

  FOR v_item IN
    SELECT
      sti.inventory_item_id,
      CASE WHEN _kind = 'weekly' THEN sti.consumption_value
           ELSE COALESCE(sti.variance_value, 0) END AS actual_cogs_val,
      CASE WHEN _kind = 'weekly' THEN sti.closing_qty   ELSE sti.counted_quantity END AS closing_qty,
      CASE WHEN _kind = 'weekly' THEN sti.closing_value ELSE (sti.counted_quantity * sti.unit_cost) END AS closing_val
    FROM (
      SELECT inventory_item_id,
             NULL::numeric AS consumption_value,
             NULL::numeric AS closing_qty,
             NULL::numeric AS closing_value,
             variance_value, counted_quantity, unit_cost
      FROM public.stocktake_items WHERE stocktake_id = _stocktake_id AND _kind = 'daily'
      UNION ALL
      SELECT inventory_item_id, consumption_value, closing_qty, closing_value,
             NULL::numeric, NULL::numeric, NULL::numeric
      FROM public.weekly_stocktake_items WHERE stocktake_id = _stocktake_id AND _kind = 'weekly'
    ) sti
  LOOP
    v_items_count := v_items_count + 1;

    SELECT COALESCE(SUM(cogs_amount), 0) INTO v_prov
    FROM public.provisional_cogs_postings
    WHERE inventory_item_id = v_item.inventory_item_id
      AND restaurant_id = v_restaurant_id
      AND status IN ('posted','negative_stock_flag')
      AND posted_at::date <= v_period_end
      AND (v_period_start IS NULL OR posted_at::date >= v_period_start);

    v_actual := COALESCE(v_item.actual_cogs_val, 0);
    v_variance := ROUND(v_actual - v_prov, 4);

    SELECT id, COALESCE(unit_cost,0) AS unit_cost, category_id,
           inventory_account_code, cogs_account_code
      INTO v_inv
    FROM public.inventory_items
    WHERE id = v_item.inventory_item_id;

    v_inv_acct_code  := v_inv.inventory_account_code;
    v_cogs_acct_code := v_inv.cogs_account_code;
    IF v_inv_acct_code IS NULL OR v_cogs_acct_code IS NULL THEN
      SELECT COALESCE(v_inv_acct_code, ic.inventory_account_code),
             COALESCE(v_cogs_acct_code, ic.cogs_account_code)
        INTO v_inv_acct_code, v_cogs_acct_code
      FROM public.inventory_categories ic
      WHERE ic.id = v_inv.category_id;
    END IF;
    v_inv_acct_code  := COALESCE(v_inv_acct_code, '1200');
    v_cogs_acct_code := COALESCE(v_cogs_acct_code, '5000');

    v_inv_acct_id  := public.get_account_id_by_code(v_tenant_id, v_inv_acct_code);
    v_cogs_acct_id := public.get_account_id_by_code(v_tenant_id, v_cogs_acct_code);

    IF ABS(v_variance) >= 0.01 AND v_inv_acct_id IS NOT NULL AND v_cogs_acct_id IS NOT NULL THEN
      v_items_var := v_items_var + 1;
      IF v_variance > 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit,
           description, reference_type, reference_id, batch_id)
        VALUES
          (v_tenant_id, v_cogs_acct_id, v_period_end, v_variance, 0,
           'COGS true-up DR', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id),
          (v_tenant_id, v_inv_acct_id, v_period_end, 0, v_variance,
           'COGS true-up CR Inventory', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id);
      ELSE
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit,
           description, reference_type, reference_id, batch_id)
        VALUES
          (v_tenant_id, v_inv_acct_id, v_period_end, ABS(v_variance), 0,
           'COGS true-up DR Inventory', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id),
          (v_tenant_id, v_cogs_acct_id, v_period_end, 0, ABS(v_variance),
           'COGS true-up CR COGS reversal', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id);
      END IF;
    END IF;

    v_new_wac := NULL;
    IF _correct_wac AND v_item.closing_qty IS NOT NULL AND v_item.closing_qty > 0 AND v_item.closing_val IS NOT NULL THEN
      v_new_wac := ROUND(v_item.closing_val / v_item.closing_qty, 6);
      UPDATE public.inventory_items
         SET unit_cost = v_new_wac, updated_at = now()
       WHERE id = v_item.inventory_item_id
         AND ABS(COALESCE(unit_cost,0) - v_new_wac) >= 0.0001;
    END IF;

    INSERT INTO public.cogs_trueup_adjustments
      (trueup_run_id, inventory_item_id,
       provisional_cogs, actual_cogs, variance,
       prev_wac, new_wac, wac_corrected,
       inventory_account_code, cogs_account_code)
    VALUES
      (v_run_id, v_item.inventory_item_id,
       v_prov, v_actual, v_variance,
       v_inv.unit_cost, v_new_wac, (v_new_wac IS NOT NULL),
       v_inv_acct_code, v_cogs_acct_code);

    v_total_prov := v_total_prov + v_prov;
    v_total_act  := v_total_act + v_actual;
    v_total_var  := v_total_var + v_variance;
  END LOOP;

  UPDATE public.cogs_trueup_runs
     SET total_provisional_cogs = v_total_prov,
         total_actual_cogs = v_total_act,
         total_variance = v_total_var,
         items_count = v_items_count,
         items_with_variance = v_items_var
   WHERE id = v_run_id;

  RETURN v_run_id;
END;
$function$;

-- Stock-count true-up (periodic method) for businesses that buy food into inventory accounts
-- (expenses / purchase invoices debit 1200 etc.) without recipes: at month end the book value of
-- an inventory account minus the value counted on the shelves is what was used, posted
-- DR cost of goods / CR inventory (a count above book posts the reverse). Once per account and
-- month (reference STOCK-<code>-YYYYMM); a locked month refuses it (period lock trigger).
CREATE OR REPLACE FUNCTION public.post_stock_count_true_up(
  p_restaurant_id uuid, p_period_end date, p_inventory_account_id uuid, p_counted_value numeric,
  p_cogs_account_id uuid DEFAULT NULL, p_notes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_inv record;
  v_cogs uuid;
  v_book numeric;
  v_diff numeric;
  v_ref text;
  v_batch uuid;
  v_branch uuid;
  v_desc text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM restaurants WHERE id = p_restaurant_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to post a stock count' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_tenant_access(v_tenant);
  PERFORM public.assert_restaurant_access(p_restaurant_id);
  IF NOT public.can_post_journal_entries(v_tenant) THEN
    RAISE EXCEPTION 'Not allowed to post cost of goods for this business' USING ERRCODE = '42501';
  END IF;
  IF p_counted_value IS NULL OR p_counted_value < 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Enter the counted stock value (0 or more)';
  END IF;

  SELECT id, account_code, account_name INTO v_inv FROM chart_of_accounts
  WHERE id = p_inventory_account_id AND tenant_id = v_tenant AND account_type = 'asset' AND is_active
    AND account_code BETWEEN '1200' AND '1299';
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Choose an active inventory account (1200-1299)';
  END IF;

  v_cogs := COALESCE(p_cogs_account_id, (
    SELECT id FROM chart_of_accounts WHERE tenant_id = v_tenant AND account_code = '5000' AND is_active LIMIT 1));
  IF v_cogs IS NULL OR NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE id = v_cogs AND tenant_id = v_tenant AND account_type = 'cogs' AND is_active) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Choose an active cost of goods account (5000s)';
  END IF;

  v_ref := 'STOCK-' || v_inv.account_code || '-' || to_char(p_period_end, 'YYYYMM');
  IF EXISTS (SELECT 1 FROM journal_entry_batches WHERE tenant_id = v_tenant AND reference_number = v_ref) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: A stock count for % is already posted for %', v_inv.account_code, to_char(p_period_end, 'Mon YYYY');
  END IF;

  SELECT COALESCE(sum(COALESCE(debit, 0) - COALESCE(credit, 0)), 0) INTO v_book
  FROM account_transactions
  WHERE tenant_id = v_tenant AND account_id = v_inv.id AND NOT COALESCE(is_voided, false)
    AND transaction_date <= p_period_end;

  v_diff := round(v_book - p_counted_value, 2);
  IF v_diff = 0 THEN
    RETURN jsonb_build_object('book_value', round(v_book, 2), 'counted_value', p_counted_value, 'cost_of_goods', 0, 'batch_id', NULL);
  END IF;

  SELECT get_primary_branch_id(p_restaurant_id) INTO v_branch;
  v_desc := 'Stock count ' || v_inv.account_code || ' ' || v_inv.account_name || ', ' || to_char(p_period_end, 'DD Mon YYYY')
            || ': book ' || to_char(v_book, 'FM999999990.00') || ', counted ' || to_char(p_counted_value, 'FM999999990.00')
            || COALESCE(' - ' || NULLIF(btrim(p_notes), ''), '');
  INSERT INTO journal_entry_batches (tenant_id, branch_id, batch_date, description, reference_number, entry_type,
                                     journal_type, created_by, is_posted, posted_at, posted_by, approval_status)
  VALUES (v_tenant, v_branch, p_period_end, v_desc, v_ref, 'adjustment', 'consumption', auth.uid(), true, now(), auth.uid(), 'approved')
  RETURNING id INTO v_batch;

  INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, credit, description,
                                    reference_type, reference_id, created_by, batch_id)
  VALUES (v_tenant, v_branch, v_cogs, p_period_end, GREATEST(v_diff, 0), GREATEST(-v_diff, 0), v_desc, 'stock_count', v_batch, auth.uid(), v_batch),
         (v_tenant, v_branch, v_inv.id, p_period_end, GREATEST(-v_diff, 0), GREATEST(v_diff, 0), v_desc, 'stock_count', v_batch, auth.uid(), v_batch);

  RETURN jsonb_build_object('book_value', round(v_book, 2), 'counted_value', p_counted_value, 'cost_of_goods', v_diff, 'batch_id', v_batch);
END;
$function$;
REVOKE ALL ON FUNCTION public.post_stock_count_true_up(uuid, date, uuid, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_stock_count_true_up(uuid, date, uuid, numeric, uuid, text) TO authenticated, service_role;
