
ALTER TABLE public.pos_hardware_settings
  ADD COLUMN IF NOT EXISTS hala_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hala_terminal_id text,
  ADD COLUMN IF NOT EXISTS hala_mock_mode boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hala_approve_probability numeric NOT NULL DEFAULT 0.9;

ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS hala_status text,
  ADD COLUMN IF NOT EXISTS hala_reference text,
  ADD COLUMN IF NOT EXISTS hala_response jsonb,
  ADD COLUMN IF NOT EXISTS hala_charged_at timestamptz;
