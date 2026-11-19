CREATE TABLE public.branch_license_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL UNIQUE REFERENCES public.restaurants(id) ON DELETE CASCADE,
  seat_count int NOT NULL DEFAULT 1 CHECK (seat_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.branch_license_seats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view seats"
ON public.branch_license_seats FOR SELECT
TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "owners can update seats"
ON public.branch_license_seats FOR UPDATE
TO authenticated
USING (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role))
WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role));

CREATE TABLE public.device_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  terminal_id text NOT NULL,
  device_label text,
  user_agent text,
  platform text,
  claimed_by_user_id uuid,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_validated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX device_licenses_active_uniq
  ON public.device_licenses (restaurant_id, terminal_id)
  WHERE revoked_at IS NULL;
CREATE INDEX device_licenses_tenant_idx ON public.device_licenses (tenant_id);

ALTER TABLE public.device_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers can view devices in tenant"
ON public.device_licenses FOR SELECT
TO authenticated
USING (
  public.can_access_restaurant(restaurant_id) AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role) OR
    public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role) OR
    claimed_by_user_id = auth.uid()
  )
);

CREATE TABLE public.license_status_cache (
  tenant_id uuid PRIMARY KEY,
  subscription_status text NOT NULL DEFAULT 'none',
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  stripe_customer_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.license_status_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view status"
ON public.license_status_cache FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = auth.uid() AND utr.tenant_id = license_status_cache.tenant_id
  )
);

CREATE TRIGGER bls_updated_at
BEFORE UPDATE ON public.branch_license_seats
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lsc_updated_at
BEFORE UPDATE ON public.license_status_cache
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.branch_license_seats (tenant_id, restaurant_id, seat_count)
SELECT tenant_id, id, 1 FROM public.restaurants
ON CONFLICT (restaurant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_branch_license_seat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.branch_license_seats (tenant_id, restaurant_id, seat_count)
  VALUES (NEW.tenant_id, NEW.id, 1)
  ON CONFLICT (restaurant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_branch_license_seat
AFTER INSERT ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.seed_branch_license_seat();