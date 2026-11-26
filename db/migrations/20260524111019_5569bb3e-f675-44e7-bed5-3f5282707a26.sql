
-- 1. Seed device_seats_per_branch into plans.quota_limits
UPDATE public.plans
SET quota_limits = COALESCE(quota_limits, '{}'::jsonb) || jsonb_build_object('device_seats_per_branch',
  CASE name
    WHEN 'free' THEN 1
    WHEN 'pro' THEN 3
    WHEN 'enterprise' THEN 10
    ELSE 1
  END
)
WHERE name IN ('free','pro','enterprise');

-- 2. Helper: seats allowed per branch for a tenant based on its current plan
CREATE OR REPLACE FUNCTION public.get_tenant_device_seat_cap(_tenant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (p.quota_limits->>'device_seats_per_branch')::int,
    1
  )
  FROM public.tenants t
  LEFT JOIN public.plans p ON p.id = t.plan_id
  WHERE t.id = _tenant_id
$$;

-- 3. Sync function: align branch_license_seats.seat_count with the tenant's plan
CREATE OR REPLACE FUNCTION public.sync_branch_seats_for_tenant(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cap int := public.get_tenant_device_seat_cap(_tenant_id);
BEGIN
  -- Ensure every restaurant in the tenant has a seats row, then sync to plan cap
  INSERT INTO public.branch_license_seats (tenant_id, restaurant_id, seat_count)
  SELECT r.tenant_id, r.id, cap
  FROM public.restaurants r
  WHERE r.tenant_id = _tenant_id
  ON CONFLICT (restaurant_id) DO UPDATE
    SET seat_count = EXCLUDED.seat_count,
        updated_at = now();
END;
$$;

-- 4. Trigger: when a tenant's plan changes → resync seats for all its branches
CREATE OR REPLACE FUNCTION public.trg_sync_seats_on_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    PERFORM public.sync_branch_seats_for_tenant(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_sync_seats_on_plan_change ON public.tenants;
CREATE TRIGGER tenants_sync_seats_on_plan_change
AFTER UPDATE OF plan_id ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_seats_on_plan_change();

-- 5. Trigger: when a new branch is created → seed seats from tenant's plan cap
CREATE OR REPLACE FUNCTION public.trg_seed_seats_for_new_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cap int := public.get_tenant_device_seat_cap(NEW.tenant_id);
BEGIN
  INSERT INTO public.branch_license_seats (tenant_id, restaurant_id, seat_count)
  VALUES (NEW.tenant_id, NEW.id, cap)
  ON CONFLICT (restaurant_id) DO UPDATE
    SET seat_count = EXCLUDED.seat_count,
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurants_seed_seats ON public.restaurants;
CREATE TRIGGER restaurants_seed_seats
AFTER INSERT ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.trg_seed_seats_for_new_branch();

-- 6. Backfill: sync all existing tenants to current plan
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.sync_branch_seats_for_tenant(t.id);
  END LOOP;
END $$;
