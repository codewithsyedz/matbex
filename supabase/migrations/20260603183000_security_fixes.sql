-- Security fixes:
-- 1) demo_funnel_events SELECT policies referenced the wrong column
--    (profiles.restaurant_id) and the wrong superadmin source (user_roles).
-- 2) tenant_slug_history exposed tenant_id (UUID) to anonymous users.

DROP POLICY IF EXISTS "Owners/managers view own funnel events" ON public.demo_funnel_events;
DROP POLICY IF EXISTS "Super admins view all funnel events" ON public.demo_funnel_events;

CREATE POLICY "Owners/managers view own funnel events"
  ON public.demo_funnel_events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT profiles.tenant_id FROM public.profiles WHERE profiles.id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['owner'::app_role, 'manager'::app_role])
    )
  );

CREATE POLICY "Super admins view all funnel events"
  ON public.demo_funnel_events
  FOR SELECT
  TO authenticated
  USING (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS "Slug history readable by everyone" ON public.tenant_slug_history;
REVOKE SELECT ON public.tenant_slug_history FROM anon;

CREATE OR REPLACE FUNCTION public.resolve_slug_redirect(_old_subdomain text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT new_subdomain
  FROM public.tenant_slug_history
  WHERE old_subdomain = lower(_old_subdomain)
    AND redirect_until > now()
  ORDER BY changed_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_slug_redirect(text) TO anon, authenticated;

COMMENT ON FUNCTION public.resolve_slug_redirect(text) IS
  'Public-safe redirect lookup for renamed tenant subdomains. Returns only the new subdomain string; never exposes tenant_id.';
