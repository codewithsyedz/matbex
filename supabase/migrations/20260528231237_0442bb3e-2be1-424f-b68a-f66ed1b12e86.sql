
ALTER TABLE public.menu_items
ADD COLUMN IF NOT EXISTS available_online boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_menu_items_available_online
  ON public.menu_items (restaurant_id, available_online)
  WHERE is_active = true;
