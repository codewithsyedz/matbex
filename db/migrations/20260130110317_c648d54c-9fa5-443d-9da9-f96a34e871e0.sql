-- Add is_active column to inventory_items table
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Create index for filtering active items
CREATE INDEX IF NOT EXISTS idx_inventory_items_active 
ON public.inventory_items(restaurant_id, is_active) 
WHERE is_active = true;