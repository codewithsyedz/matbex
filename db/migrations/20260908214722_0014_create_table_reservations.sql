CREATE TABLE public.table_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  guest_phone text NOT NULL,
  guest_email text,
  party_size integer NOT NULL CHECK (party_size > 0 AND party_size <= 50),
  reserved_date date NOT NULL,
  reserved_time time NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','seated','cancelled','no_show')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_table_reservations_restaurant_date ON public.table_reservations(restaurant_id, reserved_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.table_reservations TO authenticated;
GRANT INSERT ON public.table_reservations TO anon;
GRANT ALL ON public.table_reservations TO service_role;

ALTER TABLE public.table_reservations ENABLE ROW LEVEL SECURITY;

-- Guests (anonymous) may only create a booking; tenant_id is filled by trigger.
CREATE POLICY "Guests can create reservations"
  ON public.table_reservations FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    reserved_date >= (now() AT TIME ZONE 'UTC')::date - 1
    AND EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id)
  );

CREATE POLICY "Staff can view their reservations"
  ON public.table_reservations FOR SELECT
  TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Staff can update their reservations"
  ON public.table_reservations FOR UPDATE
  TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Staff can delete their reservations"
  ON public.table_reservations FOR DELETE
  TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE OR REPLACE FUNCTION public.set_reservation_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT r.tenant_id INTO NEW.tenant_id FROM public.restaurants r WHERE r.id = NEW.restaurant_id;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_reservation_tenant
  BEFORE INSERT OR UPDATE ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_reservation_tenant();