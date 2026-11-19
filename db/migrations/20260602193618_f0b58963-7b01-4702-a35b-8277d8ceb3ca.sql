CREATE TABLE public.landing_strings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL DEFAULT 'misc',
  value_en TEXT,
  value_ar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.landing_strings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_strings TO authenticated;
GRANT ALL ON public.landing_strings TO service_role;

ALTER TABLE public.landing_strings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Landing strings are publicly readable"
  ON public.landing_strings FOR SELECT
  USING (true);

CREATE POLICY "Super admins can insert landing strings"
  ON public.landing_strings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "Super admins can update landing strings"
  ON public.landing_strings FOR UPDATE
  TO authenticated
  USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Super admins can delete landing strings"
  ON public.landing_strings FOR DELETE
  TO authenticated
  USING (public.is_superadmin(auth.uid()));

CREATE TRIGGER trg_landing_strings_updated_at
  BEFORE UPDATE ON public.landing_strings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_landing_strings_group ON public.landing_strings(group_name);