
-- 1) feature_flags: restrict SELECT to superadmins
DROP POLICY IF EXISTS "Authenticated users can read feature flags" ON public.feature_flags;

CREATE POLICY "SuperAdmins can read feature flags"
ON public.feature_flags FOR SELECT TO authenticated
USING (is_superadmin(auth.uid()));

CREATE OR REPLACE FUNCTION public.get_feature_flags_for_tenant(_tenant_id uuid)
RETURNS TABLE(flag_key text, is_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ff.key AS flag_key,
    CASE
      WHEN _tenant_id = ANY (COALESCE(ff.disabled_tenant_ids, ARRAY[]::uuid[])) THEN false
      WHEN ff.enabled THEN true
      WHEN _tenant_id = ANY (COALESCE(ff.rollout_tenant_ids, ARRAY[]::uuid[])) THEN true
      ELSE false
    END
  FROM public.feature_flags ff
  WHERE is_superadmin(auth.uid())
     OR EXISTS (
       SELECT 1 FROM public.user_tenant_roles utr
       WHERE utr.user_id = auth.uid() AND utr.tenant_id = _tenant_id
     );
$$;

REVOKE ALL ON FUNCTION public.get_feature_flags_for_tenant(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_feature_flags_for_tenant(uuid) TO authenticated;

-- 2) Storage policies

-- press-assets
DROP POLICY IF EXISTS "Admins can update press assets" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete press assets" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload press assets" ON storage.objects;

CREATE POLICY "SuperAdmins can upload press assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'press-assets' AND is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can update press assets"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'press-assets' AND is_superadmin(auth.uid()))
WITH CHECK (bucket_id = 'press-assets' AND is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can delete press assets"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'press-assets' AND is_superadmin(auth.uid()));

-- tenant-assets: first folder = tenant_id
DROP POLICY IF EXISTS "Authenticated users can upload tenant assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can update tenant assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete tenant assets" ON storage.objects;

CREATE POLICY "Tenant owners can upload tenant assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'tenant-assets' AND (
    is_superadmin(auth.uid())
    OR has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'owner'::app_role)
    OR has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'manager'::app_role)
  )
);

CREATE POLICY "Tenant owners can update tenant assets"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'tenant-assets' AND (
    is_superadmin(auth.uid())
    OR has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'owner'::app_role)
    OR has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'manager'::app_role)
  )
);

CREATE POLICY "Tenant owners can delete tenant assets"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'tenant-assets' AND (
    is_superadmin(auth.uid())
    OR has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'owner'::app_role)
    OR has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'manager'::app_role)
  )
);

-- restaurant-logos: first folder = restaurant_id
DROP POLICY IF EXISTS "Authenticated users can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their restaurant logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their restaurant logos" ON storage.objects;

CREATE POLICY "Restaurant owners can upload logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'restaurant-logos' AND (
    is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (ur.restaurant_id)::text = (storage.foldername(name))[1]
        AND ur.role = ANY (ARRAY['owner'::app_role, 'manager'::app_role])
    )
  )
);

CREATE POLICY "Restaurant owners can update logos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'restaurant-logos' AND (
    is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (ur.restaurant_id)::text = (storage.foldername(name))[1]
        AND ur.role = ANY (ARRAY['owner'::app_role, 'manager'::app_role])
    )
  )
);

CREATE POLICY "Restaurant owners can delete logos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'restaurant-logos' AND (
    is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND (ur.restaurant_id)::text = (storage.foldername(name))[1]
        AND ur.role = ANY (ARRAY['owner'::app_role, 'manager'::app_role])
    )
  )
);

-- 3) user_sessions: hide raw session_token from API roles
REVOKE SELECT (session_token) ON public.user_sessions FROM authenticated;
REVOKE SELECT (session_token) ON public.user_sessions FROM anon;
