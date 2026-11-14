
-- 1) feature_flags: drop blanket authenticated SELECT
DROP POLICY IF EXISTS "Authenticated can read feature flags" ON public.feature_flags;

-- 2) table_qr_codes: drop public token enumeration; edge function uses service role
DROP POLICY IF EXISTS "Anyone can resolve active token" ON public.table_qr_codes;

-- 3) CFD: replace anon table-scans with scoped RPCs
DROP POLICY IF EXISTS "cfd_idle_settings_public_read" ON public.cfd_idle_settings;
DROP POLICY IF EXISTS "cfd_promos_public_read" ON public.cfd_promos;

CREATE OR REPLACE FUNCTION public.get_cfd_idle_settings(_restaurant_id uuid)
RETURNS SETOF public.cfd_idle_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.cfd_idle_settings WHERE restaurant_id = _restaurant_id;
$$;

CREATE OR REPLACE FUNCTION public.get_cfd_promos(_restaurant_id uuid)
RETURNS SETOF public.cfd_promos
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.cfd_promos
  WHERE restaurant_id = _restaurant_id AND is_active = true
  ORDER BY sort_order ASC NULLS LAST, created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_cfd_idle_settings(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cfd_promos(uuid) TO anon, authenticated;
