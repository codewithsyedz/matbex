ALTER TABLE public.device_licenses
  ADD COLUMN IF NOT EXISTS device_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS device_licenses_fingerprint_active_uniq
  ON public.device_licenses (restaurant_id, device_fingerprint)
  WHERE revoked_at IS NULL AND device_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS device_licenses_fingerprint_idx
  ON public.device_licenses (device_fingerprint)
  WHERE device_fingerprint IS NOT NULL;