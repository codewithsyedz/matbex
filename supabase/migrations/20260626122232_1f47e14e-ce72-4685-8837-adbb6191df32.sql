ALTER TABLE public.expense_categories
  ADD COLUMN IF NOT EXISTS default_inventory_item_id uuid
  REFERENCES public.inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_categories_default_inv_item
  ON public.expense_categories(default_inventory_item_id);