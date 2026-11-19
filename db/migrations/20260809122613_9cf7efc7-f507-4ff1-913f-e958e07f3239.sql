CREATE OR REPLACE FUNCTION public.convert_fine_to_installments(
  p_fine_id uuid,
  p_already_deducted numeric DEFAULT NULL,
  p_monthly_limit numeric DEFAULT NULL,
  p_start_month date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fine public.employee_fines;
  v_deducted numeric;
  v_remaining numeric;
  v_limit numeric;
  v_group uuid;
  v_start date;
  v_month date;
  v_idx integer := 1;
  v_created integer := 0;
  v_amounts numeric[] := '{}';
  v_amt numeric;
  v_left numeric;
BEGIN
  SELECT * INTO v_fine FROM public.employee_fines WHERE id = p_fine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINE_NOT_FOUND'; END IF;
  IF v_fine.deleted_at IS NOT NULL OR v_fine.status = 'cancelled' THEN
    RAISE EXCEPTION 'FINE_NOT_CONVERTIBLE: This fine is cancelled or deleted.';
  END IF;
  IF v_fine.installment_count IS NOT NULL AND v_fine.installment_count > 1 THEN
    RAISE EXCEPTION 'FINE_ALREADY_INSTALLMENT: This fine is already part of an installment schedule.';
  END IF;

  v_deducted := ROUND(GREATEST(COALESCE(p_already_deducted, v_fine.recovered_amount, 0), 0), 2);
  IF v_deducted > ROUND(v_fine.amount, 2) THEN
    RAISE EXCEPTION 'DEDUCTED_EXCEEDS_FINE: Already deducted % is greater than the fine amount %.',
      v_deducted, v_fine.amount;
  END IF;

  v_remaining := ROUND(v_fine.amount - v_deducted, 2);

  IF v_remaining <= 0.004 THEN
    UPDATE public.employee_fines
    SET recovered_amount = v_deducted,
        status = CASE WHEN status = 'approved' THEN 'applied' ELSE status END,
        applied_at = COALESCE(applied_at, now())
    WHERE id = p_fine_id;
    RETURN jsonb_build_object('installments_created', 0, 'already_deducted', v_deducted, 'remaining', 0);
  END IF;

  v_limit := ROUND(COALESCE(NULLIF(p_monthly_limit, 0), v_remaining), 2);
  IF v_limit <= 0 THEN v_limit := v_remaining; END IF;

  v_start := COALESCE(p_start_month, (date_trunc('month', COALESCE(v_fine.payroll_month, CURRENT_DATE))::date + INTERVAL '1 month')::date);
  v_start := date_trunc('month', v_start)::date;

  v_group := COALESCE(v_fine.installment_group_id, gen_random_uuid());

  v_left := v_remaining;
  WHILE v_left > 0.004 AND COALESCE(array_length(v_amounts, 1), 0) < 60 LOOP
    v_amt := LEAST(v_limit, v_left);
    v_amounts := array_append(v_amounts, ROUND(v_amt, 2));
    v_left := ROUND(v_left - v_amt, 2);
  END LOOP;
  IF v_left > 0.004 THEN
    v_amounts[array_length(v_amounts,1)] := ROUND(v_amounts[array_length(v_amounts,1)] + v_left, 2);
  END IF;

  UPDATE public.employee_fines
  SET amount = v_deducted,
      recovered_amount = v_deducted,
      installment_group_id = v_group,
      installment_number = 1,
      installment_count = array_length(v_amounts, 1) + 1,
      installment_total_amount = v_fine.amount
  WHERE id = p_fine_id;

  FOREACH v_amt IN ARRAY v_amounts LOOP
    v_idx := v_idx + 1;
    v_month := (v_start + ((v_idx - 2) || ' month')::interval)::date;
    INSERT INTO public.employee_fines (
      restaurant_id, branch_id, staff_id, violation_type_id, violation_date, payroll_month,
      description, attendance_reference, amount, status, created_by,
      installment_group_id, installment_number, installment_count, installment_total_amount,
      recovered_amount
    ) VALUES (
      v_fine.restaurant_id, v_fine.branch_id, v_fine.staff_id, v_fine.violation_type_id,
      v_fine.violation_date, v_month,
      'Installment ' || v_idx::text || '/' || (array_length(v_amounts,1) + 1)::text ||
        ' of ' || v_fine.amount::text || ' (balance after ' || v_deducted::text || ' already deducted)',
      v_fine.attendance_reference, v_amt,
      CASE WHEN v_fine.status IN ('approved','applied') THEN 'approved' ELSE 'draft' END,
      COALESCE(auth.uid(), v_fine.created_by),
      v_group, v_idx, array_length(v_amounts,1) + 1, v_fine.amount, 0
    );
    v_created := v_created + 1;
  END LOOP;

  INSERT INTO public.employee_fine_audit (
    fine_id, restaurant_id, action, old_amount, new_amount, reason, actor_id, metadata
  ) VALUES (
    p_fine_id, v_fine.restaurant_id, 'converted_to_installments',
    v_fine.amount, v_deducted,
    'Already deducted ' || v_deducted::text || ' kept on the original fine; remaining ' ||
      v_remaining::text || ' split into ' || v_created || ' installments',
    auth.uid(),
    jsonb_build_object(
      'original_amount', v_fine.amount,
      'already_deducted', v_deducted,
      'remaining', v_remaining,
      'monthly_limit', v_limit,
      'installments_created', v_created,
      'installment_group_id', v_group
    )
  );

  RETURN jsonb_build_object(
    'installment_group_id', v_group,
    'already_deducted', v_deducted,
    'remaining', v_remaining,
    'installments_created', v_created,
    'monthly_limit', v_limit
  );
END;
$function$;