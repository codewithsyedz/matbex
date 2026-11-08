-- Add menu item enhancement columns for the Live Menu Engine
ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS is_chefs_special BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_market_price BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS nutritional_info JSONB,
ADD COLUMN IF NOT EXISTS allergens TEXT[],
ADD COLUMN IF NOT EXISTS dietary_tags TEXT[];

-- Add realtime to menu_items and inventory_items for live sync
ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;

-- Create a view to check ingredient availability for menu items
CREATE OR REPLACE VIEW public.menu_item_availability AS
SELECT 
  mi.id as menu_item_id,
  mi.restaurant_id,
  mi.name as menu_item_name,
  mi.is_active,
  COALESCE(
    bool_and(
      CASE 
        WHEN ri.id IS NULL THEN true
        ELSE ii.current_stock >= ri.quantity_required
      END
    ),
    true
  ) as is_available,
  COALESCE(
    json_agg(
      CASE 
        WHEN ri.id IS NOT NULL AND ii.current_stock < ri.quantity_required 
        THEN json_build_object('ingredient', ii.name, 'required', ri.quantity_required, 'available', ii.current_stock)
        ELSE NULL
      END
    ) FILTER (WHERE ri.id IS NOT NULL AND ii.current_stock < ri.quantity_required),
    '[]'::json
  ) as missing_ingredients
FROM public.menu_items mi
LEFT JOIN public.recipe_ingredients ri ON mi.id = ri.menu_item_id
LEFT JOIN public.inventory_items ii ON ri.inventory_item_id = ii.id
GROUP BY mi.id, mi.restaurant_id, mi.name, mi.is_active;

-- Grant access to the view
GRANT SELECT ON public.menu_item_availability TO authenticated, anon;

-- Add comment for documentation
COMMENT ON VIEW public.menu_item_availability IS 'Real-time availability status of menu items based on ingredient stock levels';