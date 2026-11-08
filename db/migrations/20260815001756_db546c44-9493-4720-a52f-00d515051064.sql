CREATE OR REPLACE FUNCTION public.apply_fines_to_payroll(p_payroll_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pay public.payroll_records;
  v_total numeric := 0;
  v_ids uuid[];
  v_preview jsonb;
BEGIN
  SELECT * INTO v_pay FROM public.payroll_records WHERE id = p_payroll_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;

  v_preview := public.preview_payroll_deduction_allocation(p_payroll_id);
  IF (v_preview->>'requires_allocation')::boolean THEN
    RAISE EXCEPTION 'DEDUCTION_ALLOCATION_REQUIRED: Total deductions % exceed the permitted maximum % (% percent of %). Excess: %. Choose which deductions to defer.',
      v_preview->>'requested_total', v_preview->>'max_deduction',
      v_preview->>'max_deduction_pct', v_preview->>'gross_wage', v_preview->>'excess_amount';
  END IF;

  -- Installment-date based allocation: only installments scheduled on or before
  -- this payroll period end are recovered; later installments stay pending.
  SELECT COALESCE(SUM(GREATEST(amount - COALESCE(recovered_amount, 0), 0)), 0),
         COALESCE(array_agg(id), '{}')
  INTO v_total, v_ids
  FROM public.employee_fines
  WHERE staff_id = v_pay.staff_id
    AND status = 'approved'
    AND deleted_at IS NULL
    AND payroll_month <= v_pay.period_end
    AND GREATEST(amount - COALESCE(recovered_amount, 0), 0) > 0;

  UPDATE public.payroll_records SET fines_deducted = v_total WHERE id = p_payroll_id;

  UPDATE public.employee_fines
  SET status = 'applied',
      recovered_amount = amount,
      applied_payroll_id = p_payroll_id,
      applied_at = now()
  WHERE id = ANY(v_ids);

  RETURN jsonb_build_object('applied_count', COALESCE(array_length(v_ids,1),0), 'total', v_total);
END;
$function$;