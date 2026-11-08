
CREATE TABLE public.feature_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  rollout_tenant_ids UUID[] NOT NULL DEFAULT '{}',
  disabled_tenant_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feature_flags_key ON public.feature_flags(key);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_superadmin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.superadmin_users WHERE user_id = _user_id
  );
$$;

CREATE POLICY "Authenticated users can read feature flags"
ON public.feature_flags FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "SuperAdmins can insert feature flags"
ON public.feature_flags FOR INSERT
TO authenticated
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can update feature flags"
ON public.feature_flags FOR UPDATE
TO authenticated
USING (public.is_superadmin(auth.uid()))
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins can delete feature flags"
ON public.feature_flags FOR DELETE
TO authenticated
USING (public.is_superadmin(auth.uid()));

CREATE TRIGGER update_feature_flags_updated_at
BEFORE UPDATE ON public.feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.feature_flags;
ALTER TABLE public.feature_flags REPLICA IDENTITY FULL;
