ALTER TABLE public.zatca_devices
  ADD COLUMN IF NOT EXISTS compliance_csid_secret text,
  ADD COLUMN IF NOT EXISTS production_csid_secret text,
  ADD COLUMN IF NOT EXISTS compliance_request_id text,
  ADD COLUMN IF NOT EXISTS compliance_passed_at timestamptz;