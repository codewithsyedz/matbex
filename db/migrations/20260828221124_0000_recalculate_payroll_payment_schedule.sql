CREATE OR REPLACE FUNCTION public.recalculate_payroll_payment_schedule(
  p_restaurant_id uuid,
  p_from_period_start date DEFAULT NULL,
  p_reprorate boolean DEFAULT true,
  p_dry_run boolean DEFAULT true,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  payroll_id uuid,
  staff_name text,
  period_start date,
  period_end date,
  old_payment_date date,
  new_payment_date date,
  old_amount numeric,
  new_amount numeric,
  applied boolean,
  skip_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_new_date date;
  v_new_amount numeric;
  v_skip text;
  v_days int;
  v_worked int;
  v_start date;
  v_end date;
BEGIN
  IF NOT (has_role(auth.uid(), p_restaurant_id, 'owner'::app_role)
          OR has_role(auth.uid(), p_restaurant_id, 'manager'::app_role)) THEN
    RAISE EXCEPTION 'Only owners or managers can recalculate payroll schedules';
  END IF;

  FOR r IN
    SELECT pr.id, pr.staff_id, pr.amount, pr.payment_date, pr.period_start, pr.period_end,
           pr.branch_id, pr.ledger_posted,
           s.name, s.payment_type, s.monthly_salary, s.joined_date, s.termination_date
    FROM public.payroll_records pr
    JOIN public.staff s ON s.id = pr.staff_id
    WHERE pr.restaurant_id = p_restaurant_id
      AND (p_from_period_start IS NULL OR pr.period_start >= p_from_period_start)
      AND (p_branch_id IS NULL OR COALESCE(pr.branch_id, s.assigned_branch_id) = p_branch_id)
    ORDER BY pr.period_start, s.name
  LOOP
    v_skip := NULL;
    v_new_amount := r.amount;

    -- Pay on the 1st of the month following the pay period
    v_new_date := (date_trunc('month', r.period_end::timestamp) + interval '1 month')::date;

    IF EXISTS (
      SELECT 1 FROM public.payroll_period_locks l
      WHERE l.restaurant_id = p_restaurant_id
        AND l.status = 'locked'
        AND (l.branch_id IS NULL OR l.branch_id = r.branch_id)
        AND r.period_start >= l.period_start
        AND r.period_end <= l.period_end
    ) THEN
      v_skip := 'Pay period is locked';
    END IF;

    IF v_skip IS NULL AND p_reprorate AND r.payment_type = 'monthly' AND COALESCE(r.monthly_salary, 0) > 0 THEN
      v_days := (r.period_end - r.period_start) + 1;
      v_start := GREATEST(r.period_start, r.joined_date);
      v_end := LEAST(r.period_end, COALESCE(r.termination_date, r.period_end));
      v_worked := GREATEST((v_end - v_start) + 1, 0);
      IF v_worked >= v_days THEN
        v_new_amount := ROUND(r.monthly_salary::numeric, 2);
      ELSE
        v_new_amount := ROUND((r.monthly_salary::numeric * v_worked) / NULLIF(v_days, 0), 2);
      END IF;
    END IF;

    IF v_skip IS NULL AND NOT p_dry_run
       AND (v_new_date IS DISTINCT FROM r.payment_date OR v_new_amount IS DISTINCT FROM r.amount) THEN
      UPDATE public.payroll_records
      SET payment_date = v_new_date,
          amount = v_new_amount
      WHERE id = r.id;
    END IF;

    payroll_id := r.id;
    staff_name := r.name;
    period_start := r.period_start;
    period_end := r.period_end;
    old_payment_date := r.payment_date;
    new_payment_date := COALESCE(v_new_date, r.payment_date);
    old_amount := r.amount;
    new_amount := v_new_amount;
    applied := (v_skip IS NULL AND NOT p_dry_run
                AND (v_new_date IS DISTINCT FROM r.payment_date OR v_new_amount IS DISTINCT FROM r.amount));
    skip_reason := v_skip;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_payroll_payment_schedule(uuid, date, boolean, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_payroll_payment_schedule(uuid, date, boolean, boolean, uuid) TO authenticated;