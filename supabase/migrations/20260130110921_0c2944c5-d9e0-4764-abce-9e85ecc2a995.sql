-- Add category column to inventory_items table
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS category text;

-- Create index for filtering by category
CREATE INDEX IF NOT EXISTS idx_inventory_items_category 
ON public.inventory_items(restaurant_id, category);