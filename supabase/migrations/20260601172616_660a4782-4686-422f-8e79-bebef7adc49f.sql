ALTER TABLE public.tenant_domains
  ADD COLUMN IF NOT EXISTS cf_hostname_id text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_error text;

CREATE INDEX IF NOT EXISTS idx_tenant_domains_active_custom
  ON public.tenant_domains (custom_domain)
  WHERE custom_domain IS NOT NULL AND domain_status = 'active';