-- allow_sale_stock_movement_types
--
-- post_provisional_cogs_for_sale_item() (trigger on every sales_items insert, since
-- 20260502233619) records stock movements of type 'sale_consumption', and
-- reverse_provisional_cogs_for_sale_item() records 'sale_reversal'. The check constraint on
-- stock_movements (20260423190824) never allowed either, so on a database built from the
-- migrations any sale containing a dish with a recipe failed when its line was inserted
-- (found while testing /api/v1/pos/sales). Recreate the check with both types. Safe if a
-- production database was already widened by hand.

ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('purchase', 'usage', 'adjustment', 'waste', 'transfer', 'sale_consumption', 'sale_reversal'));
