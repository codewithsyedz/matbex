
ALTER TABLE public.pos_hardware_settings
  ADD COLUMN IF NOT EXISTS pos_layout_template text NOT NULL DEFAULT 'classic_dense',
  ADD COLUMN IF NOT EXISTS pos_layout_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.pos_hardware_settings
  DROP CONSTRAINT IF EXISTS pos_hardware_settings_pos_layout_template_chk;
ALTER TABLE public.pos_hardware_settings
  ADD CONSTRAINT pos_hardware_settings_pos_layout_template_chk
  CHECK (pos_layout_template IN ('classic_dense','showcase','compact_list','kiosk_grid','poscom_card'));
