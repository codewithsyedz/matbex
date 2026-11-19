
-- KIOSK
CREATE TABLE public.kiosk_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  pairing_code text UNIQUE,
  paired_terminal_id uuid,
  last_seen_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_kiosk_devices_restaurant ON public.kiosk_devices(restaurant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kiosk_devices TO authenticated;
GRANT ALL ON public.kiosk_devices TO service_role;
ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant view kiosk" ON public.kiosk_devices FOR SELECT TO authenticated USING (can_access_restaurant(restaurant_id));
CREATE POLICY "managers manage kiosk" ON public.kiosk_devices FOR ALL TO authenticated
  USING (can_access_restaurant(restaurant_id) AND (has_tenant_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_tenant_role(auth.uid(), restaurant_id, 'manager'::app_role)))
  WITH CHECK (can_access_restaurant(restaurant_id) AND (has_tenant_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_tenant_role(auth.uid(), restaurant_id, 'manager'::app_role)));

CREATE TRIGGER trg_kiosk_devices_updated_at BEFORE UPDATE ON public.kiosk_devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.kiosk_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.kiosk_devices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','ordering','paying','completed','abandoned')),
  cart jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric NOT NULL DEFAULT 0,
  order_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX idx_kiosk_sessions_restaurant ON public.kiosk_sessions(restaurant_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.kiosk_sessions TO authenticated;
GRANT ALL ON public.kiosk_sessions TO service_role;
ALTER TABLE public.kiosk_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant view kiosk sessions" ON public.kiosk_sessions FOR SELECT TO authenticated USING (can_access_restaurant(restaurant_id));
CREATE POLICY "tenant insert kiosk sessions" ON public.kiosk_sessions FOR INSERT TO authenticated WITH CHECK (can_access_restaurant(restaurant_id));
CREATE POLICY "tenant update kiosk sessions" ON public.kiosk_sessions FOR UPDATE TO authenticated USING (can_access_restaurant(restaurant_id));

-- RIDERS
DO $$ BEGIN
  CREATE TYPE public.rider_status AS ENUM ('available','on_delivery','offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id uuid,
  name text NOT NULL,
  phone text,
  vehicle text,
  status public.rider_status NOT NULL DEFAULT 'offline',
  current_lat numeric,
  current_lng numeric,
  last_ping_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_riders_restaurant ON public.riders(restaurant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.riders TO authenticated;
GRANT ALL ON public.riders TO service_role;
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant view riders" ON public.riders FOR SELECT TO authenticated USING (can_access_restaurant(restaurant_id));
CREATE POLICY "managers manage riders" ON public.riders FOR ALL TO authenticated
  USING (can_access_restaurant(restaurant_id) AND (has_tenant_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_tenant_role(auth.uid(), restaurant_id, 'manager'::app_role)))
  WITH CHECK (can_access_restaurant(restaurant_id) AND (has_tenant_role(auth.uid(), restaurant_id, 'owner'::app_role) OR has_tenant_role(auth.uid(), restaurant_id, 'manager'::app_role)));
CREATE POLICY "rider self update" ON public.riders FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_riders_updated_at BEFORE UPDATE ON public.riders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.delivery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','picked_up','delivered','cancelled')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  delivery_address text,
  delivery_lat numeric,
  delivery_lng numeric,
  route_polyline text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_assignments_rider ON public.delivery_assignments(rider_id, status);
CREATE INDEX idx_delivery_assignments_restaurant ON public.delivery_assignments(restaurant_id, assigned_at DESC);
CREATE INDEX idx_delivery_assignments_order ON public.delivery_assignments(order_id);

GRANT SELECT, INSERT, UPDATE ON public.delivery_assignments TO authenticated;
GRANT ALL ON public.delivery_assignments TO service_role;
ALTER TABLE public.delivery_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant view assignments" ON public.delivery_assignments FOR SELECT TO authenticated USING (can_access_restaurant(restaurant_id));
CREATE POLICY "tenant insert assignments" ON public.delivery_assignments FOR INSERT TO authenticated WITH CHECK (can_access_restaurant(restaurant_id));
CREATE POLICY "tenant update assignments" ON public.delivery_assignments FOR UPDATE TO authenticated USING (can_access_restaurant(restaurant_id));

CREATE TRIGGER trg_delivery_assignments_updated_at BEFORE UPDATE ON public.delivery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Keep rider status in sync with active assignment
CREATE OR REPLACE FUNCTION public.sync_rider_status_on_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'assigned' THEN
    UPDATE public.riders SET status = 'on_delivery' WHERE id = NEW.rider_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IN ('delivered','cancelled') AND OLD.status NOT IN ('delivered','cancelled') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_assignments
       WHERE rider_id = NEW.rider_id AND status IN ('assigned','picked_up') AND id <> NEW.id
    ) THEN
      UPDATE public.riders SET status = 'available' WHERE id = NEW.rider_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_sync_rider_status
  AFTER INSERT OR UPDATE ON public.delivery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.sync_rider_status_on_assignment();
