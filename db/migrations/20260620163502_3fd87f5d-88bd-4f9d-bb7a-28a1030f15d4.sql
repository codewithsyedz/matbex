
-- Backfill: for every (user, role) in user_tenant_roles, ensure a matching
-- user_roles row exists on every restaurant in that tenant.
INSERT INTO public.user_roles (user_id, restaurant_id, role)
SELECT utr.user_id, r.id, utr.role::public.app_role
FROM public.user_tenant_roles utr
JOIN public.restaurants r ON r.tenant_id = utr.tenant_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = utr.user_id
    AND ur.restaurant_id = r.id
    AND ur.role = utr.role::public.app_role
);

-- Trigger: when a restaurant is added to a tenant, mirror tenant-level roles
-- onto the new restaurant so existing owners/managers can manage it immediately.
CREATE OR REPLACE FUNCTION public.grant_tenant_roles_on_restaurant_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, restaurant_id, role)
  SELECT utr.user_id, NEW.id, utr.role::public.app_role
  FROM public.user_tenant_roles utr
  WHERE utr.tenant_id = NEW.tenant_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_tenant_roles_on_restaurant_insert ON public.restaurants;
CREATE TRIGGER trg_grant_tenant_roles_on_restaurant_insert
AFTER INSERT ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.grant_tenant_roles_on_restaurant_insert();
