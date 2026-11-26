CREATE OR REPLACE FUNCTION public.finalize_daily_overhead(
  p_restaurant_id uuid,
  p_business_date date,
  p_amount numeric,
  p_branch_id uuid DEFAULT NULL,
  p_breakdown jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_existing public.daily_overhead_closures%ROWTYPE;
  v_has_existing boolean := false;
  v_ref text;
  v_id uuid;
BEGIN
  IF p_business_date IS NULL THEN
    RAISE EXCEPTION 'A valid business date is required';
  END IF;
  IF p_business_date > (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Cannot finalize a future business date';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Overhead amount must be zero or greater';
  END IF;
  IF NOT public.can_manage_daily_overhead(p_restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised to finalize the day''s overhead';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.restaurants WHERE id = p_restaurant_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  SELECT * INTO v_existing FROM public.daily_overhead_closures
  WHERE restaurant_id = p_restaurant_id
    AND business_date = p_business_date
    AND COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  FOR UPDATE;
  v_has_existing := (v_existing.id IS NOT NULL);

  v_ref := 'OH-' || to_char(p_business_date, 'YYYYMMDD')
           || COALESCE('-' || UPPER(SUBSTRING(REPLACE(p_branch_id::text, '-', '') FROM 1 FOR 6)), '');

  PERFORM set_config('app.daily_overhead_ctx', 'on', true);

  IF v_has_existing THEN
    IF v_existing.status IN ('finalized','posted','posting_failed','adjusted') THEN
      PERFORM set_config('app.daily_overhead_ctx', 'off', true);
      RETURN v_existing.id;
    END IF;

    UPDATE public.daily_overhead_closures
    SET overhead_amount = ROUND(p_amount, 2),
        original_amount = COALESCE(original_amount, ROUND(p_amount, 2)),
        breakdown = COALESCE(p_breakdown, '{}'::jsonb),
        status = 'finalized',
        finalized_by = auth.uid(),
        finalized_at = now(),
        posting_error = NULL,
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.daily_overhead_closures (
      tenant_id, restaurant_id, branch_id, business_date, overhead_amount, original_amount,
      breakdown, status, gl_reference, finalized_by, finalized_at
    ) VALUES (
      v_tenant, p_restaurant_id, p_branch_id, p_business_date, ROUND(p_amount, 2), ROUND(p_amount, 2),
      COALESCE(p_breakdown, '{}'::jsonb), 'finalized', v_ref, auth.uid(), now()
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM set_config('app.daily_overhead_ctx', 'off', true);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Failed to finalize the overhead closure';
  END IF;

  INSERT INTO public.daily_overhead_audit (
    tenant_id, closure_id, business_date, action, amount_after, gl_reference, performed_by
  ) VALUES (v_tenant, v_id, p_business_date, 'finalized', ROUND(p_amount, 2), v_ref, auth.uid());

  RETURN v_id;
END;
$$;