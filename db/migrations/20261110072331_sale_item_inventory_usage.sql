-- Sales recorded through /api/v1/pos/sales must still show up as food cost.
--
-- Food-cost reports (Reports, Prime Cost card, Daily Profit, COGS page, weekly COGS) sum
-- public.inventory_usage. Stock for a sale is deducted once, by the sales_items trigger
-- (post_provisional_cogs_for_sale_item), which also posts the COGS journal. Writing a normal
-- inventory_usage row on top would deduct the same stock again (auto_deduct_inventory_stock),
-- so sale-driven usage rows are tagged with the sale line they come from:
--   * sale_item_id set  -> stock was already moved by the sale; skip the stock check and the
--                          deduction. The row must match a provisional COGS posting of that
--                          sale line, so it cannot be used to record usage without stock.
--   * sale_item_id null -> unchanged behaviour (manual usage entry deducts stock).
-- Deleting the sale line reverses its stock (trg_sales_items_before_delete_cogs) and removes
-- these rows (ON DELETE CASCADE), so the report and the stock stay in step.

ALTER TABLE public.inventory_usage
  ADD COLUMN IF NOT EXISTS sale_item_id uuid REFERENCES public.sales_items(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_usage_sale_item_uidx
  ON public.inventory_usage (sale_item_id, inventory_item_id)
  WHERE sale_item_id IS NOT NULL;

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
  IF NEW.usage_date IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Consumption date is required for inventory usage entries.';
  END IF;

  IF NEW.usage_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Consumption date cannot be in the future.';
  END IF;

  IF NEW.sale_item_id IS NOT NULL THEN
    -- Stock already moved by the sale; only accept rows that mirror a posting of that line.
    IF NOT EXISTS (
      SELECT 1 FROM public.provisional_cogs_postings p
      WHERE p.sale_item_id = NEW.sale_item_id
        AND p.inventory_item_id = NEW.inventory_item_id
        AND p.restaurant_id = NEW.restaurant_id
        AND p.status <> 'reversed'
    ) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Sale usage must match a stock posting of the same sale line.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT current_stock, name INTO v_current_stock, v_item_name
  FROM public.inventory_items
  WHERE id = NEW.inventory_item_id;

  IF v_current_stock < NEW.quantity_used THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Insufficient stock for "%" - Available: %, Requested: %. Negative inventory is not allowed.',
      v_item_name, v_current_stock, NEW.quantity_used;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_deduct_inventory_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.sale_item_id IS NOT NULL THEN
    RETURN NEW; -- deducted by the sale (post_provisional_cogs_for_sale_item)
  END IF;

  UPDATE public.inventory_items
  SET current_stock = current_stock - NEW.quantity_used,
      updated_at = now()
  WHERE id = NEW.inventory_item_id;

  RETURN NEW;
END;
$$;
