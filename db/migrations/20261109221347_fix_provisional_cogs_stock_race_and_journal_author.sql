-- fix_provisional_cogs_stock_race_and_journal_author
--
-- post_provisional_cogs_for_sale_item() runs for every sales_items row (trigger) and is the
-- place where recipe ingredients are deducted from stock. Two defects, both found while
-- testing /api/v1/pos/sales:
--
-- 1. When the inventory and COGS accounts resolve (for example after the standard chart of
--    accounts is seeded, 20261109102727), it inserts a journal_entry_batches row without
--    created_by, which is NOT NULL with no default. The whole sale then fails. Without this fix,
--    tenants that gained accounts from the chart-of-accounts backfill could no longer sell
--    dishes that have recipes.
-- 2. Stock was updated by reading current_stock and writing back a computed value, so two
--    tills selling the same dish at the same moment could lose a deduction. It is now one
--    atomic UPDATE ... RETURNING.
--
-- Everything else in the function is unchanged.

CREATE OR REPLACE FUNCTION public.post_provisional_cogs_for_sale_item(_sale_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_si              record;
  v_tenant_id       uuid;
  v_restaurant_id   uuid;
  v_ing             record;
  v_inv             record;
  v_qty_consumed    numeric;
  v_cost            numeric;
  v_cogs_amt        numeric;
  v_inv_acct_code   text;
  v_cogs_acct_code  text;
  v_inv_acct_id     uuid;
  v_cogs_acct_id    uuid;
  v_inv_cat_id      uuid;
  v_stock_before    numeric;
  v_stock_after     numeric;
  v_movement_id     uuid;
  v_batch_id        uuid;
  v_dr_id           uuid;
  v_cr_id           uuid;
  v_neg_flag        boolean;
  v_status          text;
  v_existing        uuid;
BEGIN
  -- Fetch sale item + transaction context
  SELECT si.id, si.transaction_id, si.menu_item_id, si.quantity, si.restaurant_id,
         st.created_at::date AS sale_date, st.receipt_number
    INTO v_si
  FROM public.sales_items si
  JOIN public.sales_transactions st ON st.id = si.transaction_id
  WHERE si.id = _sale_item_id;

  IF NOT FOUND THEN RETURN; END IF;

  v_restaurant_id := v_si.restaurant_id;
  -- Resolve tenant_id from restaurant
  SELECT tenant_id INTO v_tenant_id FROM public.restaurants WHERE id = v_restaurant_id;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  -- Iterate ingredients in the recipe (skip silently if no recipe)
  FOR v_ing IN
    SELECT ri.inventory_item_id, ri.quantity_required, ri.unit
    FROM public.recipe_ingredients ri
    WHERE ri.menu_item_id = v_si.menu_item_id
      AND ri.restaurant_id = v_restaurant_id
  LOOP
    -- Idempotency: skip if already posted for this sale_item + inventory_item
    SELECT id INTO v_existing
    FROM public.provisional_cogs_postings
    WHERE sale_item_id = _sale_item_id
      AND inventory_item_id = v_ing.inventory_item_id
      AND status IN ('pending','posted','negative_stock_flag');
    IF FOUND THEN CONTINUE; END IF;

    -- Load inventory item
    SELECT id, current_stock, COALESCE(unit_cost,0) AS unit_cost, category_id,
           inventory_account_code, cogs_account_code
      INTO v_inv
    FROM public.inventory_items
    WHERE id = v_ing.inventory_item_id;

    IF NOT FOUND THEN CONTINUE; END IF;

    v_qty_consumed := v_ing.quantity_required * v_si.quantity;
    v_cost := v_inv.unit_cost;
    v_cogs_amt := ROUND(v_qty_consumed * v_cost, 4);

    -- Resolve account codes (item override > category > standard)
    v_inv_acct_code  := v_inv.inventory_account_code;
    v_cogs_acct_code := v_inv.cogs_account_code;
    v_inv_cat_id     := v_inv.category_id;

    IF v_inv_acct_code IS NULL OR v_cogs_acct_code IS NULL THEN
      SELECT COALESCE(v_inv_acct_code, ic.inventory_account_code),
             COALESCE(v_cogs_acct_code, ic.cogs_account_code)
        INTO v_inv_acct_code, v_cogs_acct_code
      FROM public.inventory_categories ic
      WHERE ic.id = v_inv_cat_id;
    END IF;

    -- Fallback to system accounts
    v_inv_acct_code  := COALESCE(v_inv_acct_code, '1200');
    v_cogs_acct_code := COALESCE(v_cogs_acct_code, '5000');

    v_inv_acct_id  := public.get_account_id_by_code(v_tenant_id, v_inv_acct_code);
    v_cogs_acct_id := public.get_account_id_by_code(v_tenant_id, v_cogs_acct_code);

    -- Stock movement
    -- [20261110] Atomic decrement: concurrent sales of the same ingredient must not
    -- overwrite each other (was: read current_stock, then write back a computed value).
    UPDATE public.inventory_items
       SET current_stock = current_stock - v_qty_consumed, updated_at = now()
     WHERE id = v_inv.id
    RETURNING current_stock INTO v_stock_after;
    v_stock_before := v_stock_after + v_qty_consumed;
    v_neg_flag := (v_stock_after < 0);

    INSERT INTO public.stock_movements
      (tenant_id, restaurant_id, inventory_item_id, movement_type,
       quantity_change, stock_before, stock_after,
       reason, reference_type, reference_id)
    VALUES
      (v_tenant_id, v_restaurant_id, v_inv.id, 'sale_consumption',
       -v_qty_consumed, v_stock_before, v_stock_after,
       'POS sale auto-deduction' || CASE WHEN v_neg_flag THEN ' (NEGATIVE STOCK)' ELSE '' END,
       'sale_item', _sale_item_id)
    RETURNING id INTO v_movement_id;

    -- Post journal only if cost > 0 and both accounts resolved
    IF v_cogs_amt > 0 AND v_inv_acct_id IS NOT NULL AND v_cogs_acct_id IS NOT NULL THEN
      -- Create batch
      -- [20261110] created_by is NOT NULL without a default: use the acting user, or the
      -- tenant's first owner for system-originated sales (sync, jobs).
      INSERT INTO public.journal_entry_batches
        (tenant_id, batch_date, description, reference_number, entry_type, journal_type, is_posted, posted_at, created_by)
      VALUES
        (v_tenant_id, v_si.sale_date,
         'Provisional COGS - sale ' || COALESCE(v_si.receipt_number,'') ,
         'COGS-' || _sale_item_id::text,
         'auto_cogs', 'provisional_cogs', true, now(),
         COALESCE(auth.uid(),
                  (SELECT utr.user_id FROM public.user_tenant_roles utr
                    WHERE utr.tenant_id = v_tenant_id AND utr.role = 'owner'
                    ORDER BY utr.created_at LIMIT 1)))
      RETURNING id INTO v_batch_id;

      -- DR COGS
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, debit, credit,
         description, reference_type, reference_id, batch_id)
      VALUES
        (v_tenant_id, v_cogs_acct_id, v_si.sale_date, v_cogs_amt, 0,
         'COGS auto-post sale_item ' || _sale_item_id::text,
         'sale_item_cogs', _sale_item_id, v_batch_id)
      RETURNING id INTO v_dr_id;

      -- CR Inventory
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, debit, credit,
         description, reference_type, reference_id, batch_id)
      VALUES
        (v_tenant_id, v_inv_acct_id, v_si.sale_date, 0, v_cogs_amt,
         'Inventory consumption sale_item ' || _sale_item_id::text,
         'sale_item_cogs', _sale_item_id, v_batch_id)
      RETURNING id INTO v_cr_id;

      v_status := CASE WHEN v_neg_flag THEN 'negative_stock_flag' ELSE 'posted' END;
    ELSE
      v_status := CASE WHEN v_neg_flag THEN 'negative_stock_flag' ELSE 'pending' END;
    END IF;

    -- Record provisional posting
    INSERT INTO public.provisional_cogs_postings
      (tenant_id, restaurant_id, sale_item_id, menu_item_id, inventory_item_id,
       inventory_category_id, qty_consumed, unit_cost_at_sale, cogs_amount,
       inventory_account_code, cogs_account_code, stock_movement_id,
       ledger_transaction_debit_id, ledger_transaction_credit_id,
       status, is_negative_stock, posted_at)
    VALUES
      (v_tenant_id, v_restaurant_id, _sale_item_id, v_si.menu_item_id, v_inv.id,
       v_inv_cat_id, v_qty_consumed, v_cost, v_cogs_amt,
       v_inv_acct_code, v_cogs_acct_code, v_movement_id,
       v_dr_id, v_cr_id,
       v_status, v_neg_flag, now());
  END LOOP;
END;
$function$;
