-- Fix validate_sale_shift_mode() trigger function: shifts FK column is template_id, not shift_template_id
CREATE OR REPLACE FUNCTION public.validate_sale_shift_mode()
RETURNS TRIGGER AS $$
DECLARE
  v_shift_mode public.shift_mode;
  v_template_mode public.shift_mode;
BEGIN
  -- If no shift_id provided, allow sale (defaults to per-sale mode)
  IF NEW.shift_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get shift mode from the shift + its template
  SELECT s.sales_mode, st.shift_mode
  INTO v_shift_mode, v_template_mode
  FROM public.shifts s
  LEFT JOIN public.shift_templates st ON s.template_id = st.id
  WHERE s.id = NEW.shift_id;

  -- Use template mode if shift mode not set
  v_shift_mode := COALESCE(v_shift_mode, v_template_mode, 'pos_per_sale');

  -- Block per-sale entry during shift_summary mode
  IF v_shift_mode = 'shift_summary' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: This shift uses summary mode. Individual sales cannot be recorded. Use Night Shift Summary instead.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
