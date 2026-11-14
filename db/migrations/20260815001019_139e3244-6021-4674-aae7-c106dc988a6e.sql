ALTER TABLE public.fiscal_settings
  ADD COLUMN IF NOT EXISTS payroll_cutoff_day integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS payroll_period_offset integer NOT NULL DEFAULT 1;

ALTER TABLE public.fiscal_settings
  DROP CONSTRAINT IF EXISTS fiscal_settings_payroll_cutoff_day_check;
ALTER TABLE public.fiscal_settings
  ADD CONSTRAINT fiscal_settings_payroll_cutoff_day_check
  CHECK (payroll_cutoff_day BETWEEN 1 AND 28);

ALTER TABLE public.fiscal_settings
  DROP CONSTRAINT IF EXISTS fiscal_settings_payroll_period_offset_check;
ALTER TABLE public.fiscal_settings
  ADD CONSTRAINT fiscal_settings_payroll_period_offset_check
  CHECK (payroll_period_offset BETWEEN 0 AND 3);