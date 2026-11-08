ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.menu_item_branch_categories ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY restaurant_id, category ORDER BY name) AS rn
  FROM public.menu_items
)
UPDATE public.menu_items m
SET display_order = ranked.rn
FROM ranked
WHERE m.id = ranked.id AND m.display_order = 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY restaurant_id, branch_id, category ORDER BY created_at) AS rn
  FROM public.menu_item_branch_categories
)
UPDATE public.menu_item_branch_categories b
SET display_order = ranked.rn
FROM ranked
WHERE b.id = ranked.id AND b.display_order = 0;

CREATE INDEX IF NOT EXISTS idx_menu_items_category_order
  ON public.menu_items (restaurant_id, category, display_order);
CREATE INDEX IF NOT EXISTS idx_menu_item_branch_categories_order
  ON public.menu_item_branch_categories (restaurant_id, branch_id, category, display_order);