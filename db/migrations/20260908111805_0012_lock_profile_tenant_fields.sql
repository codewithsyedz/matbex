CREATE OR REPLACE FUNCTION public.prevent_profile_tenant_self_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role / server-side admin clients and superadmins may change tenancy
  IF current_setting('role', true) = 'service_role'
     OR auth.uid() IS NULL
     OR public.is_superadmin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Changing account ownership fields is not allowed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_tenant_self_assignment ON public.profiles;
CREATE TRIGGER trg_prevent_profile_tenant_self_assignment
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_tenant_self_assignment();

CREATE OR REPLACE FUNCTION public.prevent_profile_tenant_self_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR auth.uid() IS NULL
     OR public.is_superadmin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- A signed-in user creating their own profile may not attach it to a tenant/restaurant
  IF NEW.tenant_id IS NOT NULL OR NEW.restaurant_id IS NOT NULL THEN
    RAISE EXCEPTION 'Self-service profiles cannot be attached to a restaurant account';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_tenant_self_insert ON public.profiles;
CREATE TRIGGER trg_prevent_profile_tenant_self_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_tenant_self_insert();