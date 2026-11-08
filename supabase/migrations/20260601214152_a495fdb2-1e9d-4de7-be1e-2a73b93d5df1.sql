
CREATE TABLE public.platform_currencies (
  code text PRIMARY KEY,
  name text NOT NULL,
  symbol text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_currencies TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_currencies TO authenticated;
GRANT ALL ON public.platform_currencies TO service_role;

ALTER TABLE public.platform_currencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view currencies"
ON public.platform_currencies FOR SELECT
USING (true);

CREATE POLICY "SuperAdmins can insert currencies"
ON public.platform_currencies FOR INSERT
TO authenticated
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can update currencies"
ON public.platform_currencies FOR UPDATE
TO authenticated
USING (public.is_superadmin(auth.uid()))
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can delete currencies"
ON public.platform_currencies FOR DELETE
TO authenticated
USING (public.is_superadmin(auth.uid()));

CREATE TRIGGER update_platform_currencies_updated_at
BEFORE UPDATE ON public.platform_currencies
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.platform_currencies (code, name, symbol, sort_order, is_default) VALUES
  ('SAR', 'Saudi Riyal', '﷼', 1, true),
  ('USD', 'US Dollar', '$', 2, false),
  ('EUR', 'Euro', '€', 3, false),
  ('GBP', 'British Pound', '£', 4, false),
  ('AED', 'UAE Dirham', 'د.إ', 5, false)
ON CONFLICT (code) DO NOTHING;
