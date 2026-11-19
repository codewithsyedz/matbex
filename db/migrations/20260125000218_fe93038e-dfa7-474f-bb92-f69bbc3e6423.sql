-- Add toast_position column to restaurants table
ALTER TABLE public.restaurants 
ADD COLUMN toast_position TEXT DEFAULT 'top-center';

-- Add a comment for documentation
COMMENT ON COLUMN public.restaurants.toast_position IS 'Position of toast notifications: top-left, top-center, top-right, bottom-left, bottom-center, bottom-right';