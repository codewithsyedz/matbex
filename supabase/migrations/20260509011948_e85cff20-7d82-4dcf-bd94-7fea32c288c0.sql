
ALTER TABLE public.variance_template_usage_events
  ADD COLUMN IF NOT EXISTS daily_sales_id UUID,
  ADD COLUMN IF NOT EXISTS business_date DATE,
  ADD COLUMN IF NOT EXISTS notes_snapshot TEXT;

CREATE INDEX IF NOT EXISTS idx_vtue_drilldown
  ON public.variance_template_usage_events(tenant_id, restaurant_id, template_key, abs_variance, used_at DESC);

CREATE OR REPLACE FUNCTION public.increment_variance_template_usage(
  _template_key TEXT,
  _restaurant_id UUID DEFAULT NULL,
  _variance_amount NUMERIC DEFAULT 0,
  _daily_sales_id UUID DEFAULT NULL,
  _business_date DATE DEFAULT NULL,
  _notes_snapshot TEXT DEFAULT NULL
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
    tenant_id, restaurant_id, template_key, variance_amount, abs_variance, used_by,
    daily_sales_id, business_date, notes_snapshot
  )
  VALUES (
    _tenant_id, _restaurant_id, _template_key,
    COALESCE(_variance_amount, 0), ABS(COALESCE(_variance_amount, 0)),
    auth.uid(),
    _daily_sales_id, _business_date,
    NULLIF(_notes_snapshot, '')
  );
END;
$$;
