CREATE TABLE public.platform_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SuperAdmins can view platform settings"
ON public.platform_settings FOR SELECT TO authenticated
USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can insert platform settings"
ON public.platform_settings FOR INSERT TO authenticated
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can update platform settings"
ON public.platform_settings FOR UPDATE TO authenticated
USING (public.is_superadmin(auth.uid()))
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can delete platform settings"
ON public.platform_settings FOR DELETE TO authenticated
USING (public.is_superadmin(auth.uid()));

CREATE TRIGGER trg_platform_settings_updated_at
BEFORE UPDATE ON public.platform_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();