
-- CFD idle screen settings (one row per restaurant)
CREATE TABLE IF NOT EXISTS public.cfd_idle_settings (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  heading text,
  subheading text,
  show_logo boolean NOT NULL DEFAULT true,
  rotation_seconds integer NOT NULL DEFAULT 8,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cfd_idle_rotation_range CHECK (rotation_seconds BETWEEN 3 AND 120)
);

GRANT SELECT ON public.cfd_idle_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cfd_idle_settings TO authenticated;
GRANT ALL ON public.cfd_idle_settings TO service_role;

ALTER TABLE public.cfd_idle_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cfd_idle_settings_tenant_all"
  ON public.cfd_idle_settings
  FOR ALL
  TO authenticated
  USING (can_access_restaurant(restaurant_id))
  WITH CHECK (can_access_restaurant(restaurant_id));

CREATE POLICY "cfd_idle_settings_public_read"
  ON public.cfd_idle_settings
  FOR SELECT
  TO anon
  USING (true);

CREATE TRIGGER trg_cfd_idle_settings_updated
  BEFORE UPDATE ON public.cfd_idle_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- CFD rotating promos
CREATE TABLE IF NOT EXISTS public.cfd_promos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  image_url text,
  accent_color text,
  starts_on date,
  ends_on date,
  -- 0=Sun..6=Sat; NULL means every day
  days_of_week smallint[],
  start_time time,
  end_time time,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfd_promos_restaurant_active
  ON public.cfd_promos(restaurant_id, is_active, sort_order);

GRANT SELECT ON public.cfd_promos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cfd_promos TO authenticated;
GRANT ALL ON public.cfd_promos TO service_role;

ALTER TABLE public.cfd_promos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cfd_promos_tenant_all"
  ON public.cfd_promos
  FOR ALL
  TO authenticated
  USING (can_access_restaurant(restaurant_id))
  WITH CHECK (can_access_restaurant(restaurant_id));

CREATE POLICY "cfd_promos_public_read"
  ON public.cfd_promos
  FOR SELECT
  TO anon
  USING (true);

CREATE TRIGGER trg_cfd_promos_updated
  BEFORE UPDATE ON public.cfd_promos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
