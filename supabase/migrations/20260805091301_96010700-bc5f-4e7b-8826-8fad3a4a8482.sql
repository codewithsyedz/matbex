
CREATE OR REPLACE FUNCTION public.enforce_payroll_deduction_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_set public.payroll_deduction_settings;
  v_branch uuid;
  v_gross numeric;
  v_total numeric;
  v_max numeric;
  v_pct numeric;
BEGIN
  SELECT COALESCE(NEW.branch_id, s.branch_id, s.assigned_branch_id) INTO v_branch
  FROM public.staff s WHERE s.id = NEW.staff_id;

  v_set := public.get_deduction_settings(NEW.restaurant_id, v_branch, NEW.period_end);
  v_pct := COALESCE(v_set.max_total_deduction_pct, 50);

  v_total := COALESCE(NEW.deductions,0) + COALESCE(NEW.advance_recovered,0) + COALESCE(NEW.fines_deducted,0);
  -- payroll_records.amount is the gross / due wage for the period
  v_gross := COALESCE(NULLIF(NEW.gross_wage,0), NEW.amount);
  v_max := ROUND(v_gross * v_pct / 100.0, 2);

  IF v_gross > 0 AND v_total > v_max + 0.01 THEN
    RAISE EXCEPTION 'DEDUCTION_LIMIT_EXCEEDED: Total deductions % exceed the maximum permitted % which is % percent of the due wage %. Excess: %',
      v_total, v_max, v_pct, v_gross, ROUND(v_total - v_max, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
