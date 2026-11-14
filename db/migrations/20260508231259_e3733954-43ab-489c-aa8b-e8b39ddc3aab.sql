
CREATE TABLE public.variance_template_usage_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  restaurant_id UUID,
  template_key TEXT NOT NULL,
  variance_amount NUMERIC NOT NULL DEFAULT 0,
  abs_variance NUMERIC NOT NULL DEFAULT 0,
  used_by UUID,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.variance_template_usage_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_variance_template_usage_events_lookup
  ON public.variance_template_usage_events(tenant_id, restaurant_id, template_key, used_at DESC);

CREATE POLICY "Tenant members can view template usage events"
  ON public.variance_template_usage_events FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can insert template usage events"
  ON public.variance_template_usage_events FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION public.increment_variance_template_usage(
  _template_key TEXT,
  _restaurant_id UUID DEFAULT NULL,
  _variance_amount NUMERIC DEFAULT 0
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

  INSERT INTO public.variance_template_usage_events (
    tenant_id, restaurant_id, template_key, variance_amount, abs_variance, used_by
  )
  VALUES (
    _tenant_id, _restaurant_id, _template_key,
    COALESCE(_variance_amount, 0), ABS(COALESCE(_variance_amount, 0)),
    auth.uid()
  );
END;
$$;
