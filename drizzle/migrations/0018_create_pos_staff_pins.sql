CREATE TABLE public.pos_staff_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text,
  pin_hash text NOT NULL,
  pin_salt text NOT NULL,
  iterations integer NOT NULL DEFAULT 150000,
  is_active boolean NOT NULL DEFAULT true,
  updated_by_user_id uuid,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, user_id)
);

CREATE INDEX idx_pos_staff_pins_restaurant ON public.pos_staff_pins (restaurant_id) WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_staff_pins TO authenticated;
GRANT ALL ON public.pos_staff_pins TO service_role;

ALTER TABLE public.pos_staff_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff can read till pin hashes"
ON public.pos_staff_pins FOR SELECT TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "managers or self can create till pin"
ON public.pos_staff_pins FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_restaurant(restaurant_id)
  AND (
    user_id = auth.uid()
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
  )
);

CREATE POLICY "managers or self can rotate till pin"
ON public.pos_staff_pins FOR UPDATE TO authenticated
USING (
  public.can_access_restaurant(restaurant_id)
  AND (
    user_id = auth.uid()
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
  )
)
WITH CHECK (
  public.can_access_restaurant(restaurant_id)
  AND (
    user_id = auth.uid()
    OR public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
  )
);

CREATE POLICY "managers can delete till pin"
ON public.pos_staff_pins FOR DELETE TO authenticated
USING (
  public.can_access_restaurant(restaurant_id)
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
  )
);

CREATE TRIGGER update_pos_staff_pins_updated_at
BEFORE UPDATE ON public.pos_staff_pins
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();