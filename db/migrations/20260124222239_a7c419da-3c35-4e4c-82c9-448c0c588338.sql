-- Add image_url column to menu_items table
ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.menu_items.image_url IS 'URL to the menu item image stored in Supabase storage';