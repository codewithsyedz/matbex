CREATE TABLE public.kiosk_unlock_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  terminal_id text NOT NULL,
  device_license_id uuid REFERENCES public.device_licenses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','expired','cancelled')),
  reason text,
  requested_by_user_id uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  acknowledged_at timestamptz,
  acknowledged_platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.kiosk_unlock_requests TO authenticated;
GRANT ALL ON public.kiosk_unlock_requests TO service_role;

ALTER TABLE public.kiosk_unlock_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff can view kiosk unlock requests in their restaurant"
ON public.kiosk_unlock_requests FOR SELECT TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "managers can create kiosk unlock requests"
ON public.kiosk_unlock_requests FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_restaurant(restaurant_id)
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
  )
);

CREATE POLICY "staff can update kiosk unlock requests in their restaurant"
ON public.kiosk_unlock_requests FOR UPDATE TO authenticated
USING (public.can_access_restaurant(restaurant_id))
WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE UNIQUE INDEX kiosk_unlock_requests_pending_uniq
  ON public.kiosk_unlock_requests (restaurant_id, terminal_id)
  WHERE status = 'pending';

CREATE INDEX kiosk_unlock_requests_terminal_idx
  ON public.kiosk_unlock_requests (terminal_id, status);

CREATE TRIGGER update_kiosk_unlock_requests_updated_at
BEFORE UPDATE ON public.kiosk_unlock_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();