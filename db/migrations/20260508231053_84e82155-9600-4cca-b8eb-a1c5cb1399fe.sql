
CREATE TABLE public.variance_template_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  restaurant_id UUID,
  template_key TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, restaurant_id, template_key)
);

ALTER TABLE public.variance_template_usage ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_variance_template_usage_lookup
  ON public.variance_template_usage(tenant_id, restaurant_id, use_count DESC);

CREATE POLICY "Tenant members can view template usage"
  ON public.variance_template_usage FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can insert template usage"
  ON public.variance_template_usage FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can update template usage"
  ON public.variance_template_usage FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE TRIGGER trg_variance_template_usage_updated_at
  BEFORE UPDATE ON public.variance_template_usage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.increment_variance_template_usage(
  _template_key TEXT,
  _restaurant_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  SELECT tenant_id INTO _tenant_id FROM public.profiles WHERE id = auth.uid();
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant for current user';
  END IF;

  INSERT INTO public.variance_template_usage (tenant_id, restaurant_id, template_key, use_count, last_used_at)
  VALUES (_tenant_id, _restaurant_id, _template_key, 1, now())
  ON CONFLICT (tenant_id, restaurant_id, template_key)
  DO UPDATE SET
    use_count = variance_template_usage.use_count + 1,
    last_used_at = now(),
    updated_at = now();
END;
$$;
