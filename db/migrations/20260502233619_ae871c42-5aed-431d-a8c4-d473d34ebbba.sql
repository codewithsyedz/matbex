
-- =========================================================================
-- Phase 2: Real-time provisional COGS posting from POS sales
-- =========================================================================

-- Helper: get account_id by code for a tenant
CREATE OR REPLACE FUNCTION public.get_account_id_by_code(_tenant_id uuid, _code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.chart_of_accounts
  WHERE tenant_id = _tenant_id AND account_code = _code
  LIMIT 1;
$$;

-- =========================================================================
-- Core: Post provisional COGS for a single sale_item
-- =========================================================================
CREATE OR REPLACE FUNCTION public.post_provisional_cogs_for_sale_item(_sale_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    v_stock_before := v_inv.current_stock;
    v_stock_after  := v_stock_before - v_qty_consumed;
    v_neg_flag := (v_stock_after < 0);

    UPDATE public.inventory_items
       SET current_stock = v_stock_after, updated_at = now()
     WHERE id = v_inv.id;

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
      INSERT INTO public.journal_entry_batches
        (tenant_id, batch_date, description, reference_number, entry_type, journal_type, is_posted, posted_at)
      VALUES
        (v_tenant_id, v_si.sale_date,
         'Provisional COGS - sale ' || COALESCE(v_si.receipt_number,'') ,
         'COGS-' || _sale_item_id::text,
         'auto_cogs', 'provisional_cogs', true, now())
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
$$;

-- =========================================================================
-- Reverse postings for a single sale_item (refund/void/delete)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.reverse_provisional_cogs_for_sale_item(_sale_item_id uuid, _reason text DEFAULT 'refund')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p record;
  v_inv record;
  v_stock_before numeric;
  v_stock_after numeric;
BEGIN
  FOR v_p IN
    SELECT * FROM public.provisional_cogs_postings
    WHERE sale_item_id = _sale_item_id
      AND status IN ('posted','pending','negative_stock_flag')
  LOOP
    -- Restore stock
    SELECT current_stock INTO v_stock_before
      FROM public.inventory_items WHERE id = v_p.inventory_item_id FOR UPDATE;
    v_stock_after := COALESCE(v_stock_before,0) + v_p.qty_consumed;

    UPDATE public.inventory_items
       SET current_stock = v_stock_after, updated_at = now()
     WHERE id = v_p.inventory_item_id;

    INSERT INTO public.stock_movements
      (tenant_id, restaurant_id, inventory_item_id, movement_type,
       quantity_change, stock_before, stock_after,
       reason, reference_type, reference_id)
    VALUES
      (v_p.tenant_id, v_p.restaurant_id, v_p.inventory_item_id, 'sale_reversal',
       v_p.qty_consumed, v_stock_before, v_stock_after,
       'Reversal: ' || _reason, 'sale_item_reversal', _sale_item_id);

    -- Void the journal entries (do not delete - immutable ledger)
    IF v_p.ledger_transaction_debit_id IS NOT NULL THEN
      UPDATE public.account_transactions
         SET is_voided = true, voided_at = now(), void_reason = _reason
       WHERE id = v_p.ledger_transaction_debit_id;
    END IF;
    IF v_p.ledger_transaction_credit_id IS NOT NULL THEN
      UPDATE public.account_transactions
         SET is_voided = true, voided_at = now(), void_reason = _reason
       WHERE id = v_p.ledger_transaction_credit_id;
    END IF;

    UPDATE public.provisional_cogs_postings
       SET status = 'reversed', reversed_at = now(), reversal_reason = _reason
     WHERE id = v_p.id;
  END LOOP;
END;
$$;

-- Reverse all sale items for a transaction (full void)
CREATE OR REPLACE FUNCTION public.reverse_provisional_cogs_for_sale(_transaction_id uuid, _reason text DEFAULT 'void')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM public.sales_items WHERE transaction_id = _transaction_id
  LOOP
    PERFORM public.reverse_provisional_cogs_for_sale_item(v_id, _reason);
  END LOOP;
END;
$$;

-- =========================================================================
-- Triggers
-- =========================================================================
CREATE OR REPLACE FUNCTION public.trg_sale_item_post_cogs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.post_provisional_cogs_for_sale_item(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_items_after_insert_cogs ON public.sales_items;
CREATE TRIGGER trg_sales_items_after_insert_cogs
AFTER INSERT ON public.sales_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_sale_item_post_cogs();

CREATE OR REPLACE FUNCTION public.trg_sale_item_reverse_cogs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.reverse_provisional_cogs_for_sale_item(OLD.id, 'sale_item_deleted');
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_items_before_delete_cogs ON public.sales_items;
CREATE TRIGGER trg_sales_items_before_delete_cogs
BEFORE DELETE ON public.sales_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_sale_item_reverse_cogs();

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_provisional_cogs_sale_item
  ON public.provisional_cogs_postings(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_provisional_cogs_status
  ON public.provisional_cogs_postings(tenant_id, status);
