-- Per-tenant POS layout customization (hide/show areas, image shape, spacing)
ALTER TABLE public.pos_hardware_settings
  ADD COLUMN IF NOT EXISTS pos_layout_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.pos_hardware_settings.pos_layout_config IS
  'JSON config for the Record Sale layout template: showCategoryStrip, showChooseItemsTitle, showCategoryHeaders, showDescription, imageShape (round|rounded|square), compactTopSpacing';
