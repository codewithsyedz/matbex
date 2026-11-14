ALTER TABLE public.pos_hardware_settings
  ADD COLUMN IF NOT EXISTS bar_printer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bar_printer_type text NOT NULL DEFAULT 'browser',
  ADD COLUMN IF NOT EXISTS bar_printer_ip text,
  ADD COLUMN IF NOT EXISTS bar_printer_port integer DEFAULT 9100,
  ADD COLUMN IF NOT EXISTS bar_printer_name text,
  ADD COLUMN IF NOT EXISTS print_bar_on_sale boolean NOT NULL DEFAULT true;