-- Add quarter_price column to menu_items
ALTER TABLE public.menu_items 
ADD COLUMN quarter_price numeric NOT NULL DEFAULT 0;