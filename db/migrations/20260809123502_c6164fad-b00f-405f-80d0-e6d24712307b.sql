CREATE OR REPLACE FUNCTION public.reschedule_fine_installments(
  p_fine_id uuid,
  p_monthly_limit numeric DEFAULT NULL,
  p_start_month date DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fine public.employee_fines;
  v_group uuid;
  v_total numeric;
  v_settled numeric := 0;
  v_remaining numeric;
  v_limit numeric;
  v_start date;
  v_month date;
  v_kept integer := 0;
  v_cancelled integer := 0;
  v_created integer := 0;
  v_max_no integer := 0;
  v_amounts numeric[] := '{}';
  v_amt numeric;
  v_left numeric;
  v_idx integer;
  v_anchor uuid;
  v_reason text;
BEGIN
  SELECT * INTO v_fine FROM public.employee_fines WHERE id = p_fine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINE_NOT_FOUND'; END IF;

  v_group := v_fine.installment_group_id;
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'NOT_AN_INSTALLMENT_PLAN: This fine is not part of an installment schedule. Use "Split into installments" instead.';
  END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'Installment schedule re-planned');

  PERFORM 1 FROM public.employee_fines
   WHERE installment_group_id = v_group FOR UPDATE;

  -- Anchor = first installment of the group (keeps audit history in one place)
  SELECT id INTO v_anchor FROM public.employee_fines
   WHERE installment_group_id = v_group
   ORDER BY installment_number NULLS LAST, created_at
   LIMIT 1;

  SELECT COALESCE(MAX(installment_total_amount), SUM(amount)) INTO v_total
    FROM public.employee_fines
   WHERE installment_group_id = v_group AND deleted_at IS NULL;

  -- Amounts already recovered / applied to a payroll stay untouched
  SELECT COALESCE(SUM(GREATEST(
           COALESCE(recovered_amount, 0),
           CASE WHEN status = 'applied' OR applied_payroll_id IS NOT NULL THEN amount ELSE 0 END
         )), 0),
         COUNT(*) FILTER (
           WHERE status = 'applied' OR applied_payroll_id IS NOT NULL OR COALESCE(recovered_amount,0) > 0
         )
    INTO v_settled, v_kept
    FROM public.employee_fines
   WHERE installment_group_id = v_group
     AND deleted_at IS NULL
     AND status <> 'cancelled';

  SELECT COALESCE(MAX(installment_number), 0) INTO v_max_no
    FROM public.employee_fines WHERE installment_group_id = v_group;

  -- Cancel the untouched (unpaid) future installments
  UPDATE public.employee_fines
     SET status = 'cancelled',
         cancellation_reason = v_reason
   WHERE installment_group_id = v_group
     AND deleted_at IS NULL
     AND status IN ('draft','submitted','under_review','approved','rejected')
     AND applied_payroll_id IS NULL
     AND COALESCE(recovered_amount, 0) = 0;
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  v_remaining := ROUND(COALESCE(v_total, 0) - v_settled, 2);

  IF v_remaining > 0.004 THEN
    v_limit := ROUND(COALESCE(NULLIF(p_monthly_limit, 0), v_remaining), 2);
    IF v_limit <= 0 THEN v_limit := v_remaining; END IF;

    v_start := date_trunc('month',
      COALESCE(p_start_month, (date_trunc('month', CURRENT_DATE)::date + INTERVAL '1 month')::date)
    )::date;

    v_left := v_remaining;
    WHILE v_left > 0.004 AND COALESCE(array_length(v_amounts, 1), 0) < 60 LOOP
      v_amt := LEAST(v_limit, v_left);
      v_amounts := array_append(v_amounts, ROUND(v_amt, 2));
      v_left := ROUND(v_left - v_amt, 2);
    END LOOP;
    IF v_left > 0.004 THEN
      v_amounts[array_length(v_amounts,1)] := ROUND(v_amounts[array_length(v_amounts,1)] + v_left, 2);
    END IF;

    v_idx := 0;
    FOREACH v_amt IN ARRAY v_amounts LOOP
      v_month := (v_start + (v_idx || ' month')::interval)::date;
      INSERT INTO public.employee_fines (
        restaurant_id, branch_id, staff_id, violation_type_id, violation_date, payroll_month,
        description, attendance_reference, amount, status, created_by,
        installment_group_id, installment_number, installment_count, installment_total_amount,
        recovered_amount
      ) VALUES (
        v_fine.restaurant_id, v_fine.branch_id, v_fine.staff_id, v_fine.violation_type_id,
        v_fine.violation_date, v_month,
        'Re-planned installment ' || (v_idx + 1)::text || '/' || array_length(v_amounts,1)::text ||
          ' of remaining ' || v_remaining::text,
        v_fine.attendance_reference, v_amt,
        CASE WHEN v_fine.status IN ('approved','applied') THEN 'approved' ELSE 'draft' END,
        COALESCE(auth.uid(), v_fine.created_by),
        v_group, v_max_no + v_idx + 1, v_kept + array_length(v_amounts,1),
        COALESCE(v_total, v_fine.amount), 0
      );
      v_idx := v_idx + 1;
      v_created := v_created + 1;
    END LOOP;
  END IF;

  UPDATE public.employee_fines
     SET installment_count = v_kept + v_created
   WHERE installment_group_id = v_group
     AND deleted_at IS NULL
     AND status <> 'cancelled';

  INSERT INTO public.employee_fine_audit (
    fine_id, restaurant_id, action, old_amount, new_amount, reason, actor_id, metadata
  ) VALUES (
    COALESCE(v_anchor, p_fine_id), v_fine.restaurant_id, 'installments_rescheduled',
    COALESCE(v_total, 0), v_remaining,
    v_reason || ' — ' || v_settled::text || ' already recovered kept, ' ||
      v_cancelled || ' unpaid installment(s) cancelled, ' || v_created || ' new installment(s) created',
    auth.uid(),
    jsonb_build_object(
      'installment_group_id', v_group,
      'plan_total', v_total,
      'already_recovered', v_settled,
      'remaining', v_remaining,
      'monthly_limit', v_limit,
      'kept_installments', v_kept,
      'cancelled_installments', v_cancelled,
      'installments_created', v_created,
      'start_month', v_start
    )
  );

  RETURN jsonb_build_object(
    'installment_group_id', v_group,
    'plan_total', v_total,
    'already_recovered', v_settled,
    'remaining', v_remaining,
    'kept_installments', v_kept,
    'cancelled_installments', v_cancelled,
    'installments_created', v_created,
    'monthly_limit', v_limit
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reschedule_fine_installments(uuid, numeric, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_fine_installments(uuid, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_fine_installments(uuid, numeric, date, text) TO service_role;