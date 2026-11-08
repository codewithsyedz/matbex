CREATE OR REPLACE FUNCTION public.admin_list_custom_domains()
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  tenant_name text,
  tenant_status text,
  custom_domain text,
  domain_status text,
  ssl_status text,
  cf_hostname_id text,
  verification_token text,
  verification_error text,
  dns_verified_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    td.id,
    td.tenant_id,
    t.name AS tenant_name,
    t.status AS tenant_status,
    td.custom_domain,
    td.domain_status,
    td.ssl_status,
    td.cf_hostname_id,
    td.verification_token,
    td.verification_error,
    td.dns_verified_at,
    td.last_verified_at,
    td.created_at,
    td.updated_at
  FROM public.tenant_domains td
  JOIN public.tenants t ON t.id = td.tenant_id
  WHERE td.custom_domain IS NOT NULL
    AND public.is_superadmin(auth.uid())
  ORDER BY td.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_custom_domains() TO authenticated;