ALTER TABLE public.pos_hardware_settings
  ADD COLUMN IF NOT EXISTS receipt_template text NOT NULL DEFAULT 'tax_invoice'
    CHECK (receipt_template IN ('simple', 'tax_invoice', 'detailed'));