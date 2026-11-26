-- 1. Tenants: only authenticated users may create tenants
DROP POLICY IF EXISTS "Allow tenant creation during onboarding" ON public.tenants;
CREATE POLICY "Authenticated users can create a tenant during onboarding"
ON public.tenants FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- 2. Restaurants: only authenticated tenant owners (or first restaurant during onboarding)
DROP POLICY IF EXISTS "Allow restaurant creation during onboarding" ON public.restaurants;
CREATE POLICY "Tenant owners can create restaurants"
ON public.restaurants FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = restaurants.tenant_id)
  AND (
    public.has_tenant_role(auth.uid(), restaurants.tenant_id, 'owner'::app_role)
    OR public.is_superadmin(auth.uid())
    -- onboarding: tenant has no roles assigned yet
    OR NOT EXISTS (
      SELECT 1 FROM public.user_tenant_roles r WHERE r.tenant_id = restaurants.tenant_id
    )
  )
);

-- 3. Restaurants: remove blanket public SELECT, expose a restricted storefront view instead
DROP POLICY IF EXISTS "Public can view restaurants for storefront" ON public.restaurants;

CREATE OR REPLACE VIEW public.restaurants_public
WITH (security_invoker = off) AS
  SELECT id, tenant_id, name, currency, timezone, is_primary
  FROM public.restaurants;

GRANT SELECT ON public.restaurants_public TO anon, authenticated;

-- 4. Menu items: public browsing only for restaurants with a configured storefront
CREATE OR REPLACE FUNCTION public.restaurant_has_public_storefront(_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.online_ordering_settings s
    WHERE s.restaurant_id = _restaurant_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.restaurant_has_public_storefront(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "Public can view active menu items" ON public.menu_items;
CREATE POLICY "Public can view active storefront menu items"
ON public.menu_items FOR SELECT TO anon, authenticated
USING (
  is_active = true
  AND public.restaurant_has_public_storefront(restaurant_id)
);