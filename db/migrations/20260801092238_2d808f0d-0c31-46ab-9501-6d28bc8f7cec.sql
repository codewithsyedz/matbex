CREATE TABLE public.kiosk_offline_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  pin_salt text NOT NULL,
  iterations integer NOT NULL DEFAULT 150000,
  updated_by_user_id uuid,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kiosk_offline_pins TO authenticated;
GRANT ALL ON public.kiosk_offline_pins TO service_role;

ALTER TABLE public.kiosk_offline_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff can read kiosk offline pin hash"
ON public.kiosk_offline_pins FOR SELECT TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "managers can create kiosk offline pin"
ON public.kiosk_offline_pins FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_restaurant(restaurant_id)
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
  )
);

CREATE POLICY "managers can rotate kiosk offline pin"
ON public.kiosk_offline_pins FOR UPDATE TO authenticated
USING (
  public.can_access_restaurant(restaurant_id)
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
  )
)
WITH CHECK (
  public.can_access_restaurant(restaurant_id)
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
  )
);

CREATE POLICY "owners can delete kiosk offline pin"
ON public.kiosk_offline_pins FOR DELETE TO authenticated
USING (
  public.can_access_restaurant(restaurant_id)
  AND public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
);

CREATE TRIGGER update_kiosk_offline_pins_updated_at
BEFORE UPDATE ON public.kiosk_offline_pins
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.kiosk_offline_unlock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  terminal_id text NOT NULL,
  performed_by_user_id uuid,
  reason text,
  succeeded boolean NOT NULL DEFAULT true,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  platform text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.kiosk_offline_unlock_events TO authenticated;
GRANT ALL ON public.kiosk_offline_unlock_events TO service_role;

ALTER TABLE public.kiosk_offline_unlock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff can view kiosk offline unlock events"
ON public.kiosk_offline_unlock_events FOR SELECT TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "staff can record kiosk offline unlock events"
ON public.kiosk_offline_unlock_events FOR INSERT TO authenticated
WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE INDEX kiosk_offline_unlock_events_restaurant_idx
  ON public.kiosk_offline_unlock_events (restaurant_id, occurred_at DESC);