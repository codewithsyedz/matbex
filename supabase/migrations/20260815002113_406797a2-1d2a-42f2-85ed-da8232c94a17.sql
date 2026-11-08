ALTER TABLE public.fiscal_settings
  ADD COLUMN IF NOT EXISTS fine_allocation_mode text NOT NULL DEFAULT 'installment_date';

ALTER TABLE public.fiscal_settings
  DROP CONSTRAINT IF EXISTS fiscal_settings_fine_allocation_mode_check;

ALTER TABLE public.fiscal_settings
  ADD CONSTRAINT fiscal_settings_fine_allocation_mode_check
  CHECK (fine_allocation_mode IN ('installment_date', 'created_date'));