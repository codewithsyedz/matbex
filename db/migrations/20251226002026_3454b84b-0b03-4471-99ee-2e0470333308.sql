-- Add half_price and full_price columns to menu_items
ALTER TABLE public.menu_items 
ADD COLUMN half_price numeric NOT NULL DEFAULT 0,
ADD COLUMN full_price numeric NOT NULL DEFAULT 0;

-- Migrate existing selling_price to full_price
UPDATE public.menu_items SET full_price = selling_price WHERE selling_price > 0;