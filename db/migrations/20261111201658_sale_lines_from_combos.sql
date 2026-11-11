-- sale_lines_from_combos
--
-- Combo packages could not be sold: the POS sent the combo's id as a menu item and the server
-- (POST /api/v1/pos/sales) rejected it. A combo is now recorded as its component menu items,
-- each at its share of the combo price (shares sum exactly to it), so stock, COGS and kitchen
-- tickets work per item as before. combo_id keeps the lines grouped for receipts and reports.
ALTER TABLE public.sales_items
  ADD COLUMN IF NOT EXISTS combo_id uuid REFERENCES public.combo_packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_items_combo_id_idx ON public.sales_items (combo_id) WHERE combo_id IS NOT NULL;
COMMENT ON COLUMN public.sales_items.combo_id IS
  'Set when the line is part of a combo package; the combo''s lines together carry the combo price.';
