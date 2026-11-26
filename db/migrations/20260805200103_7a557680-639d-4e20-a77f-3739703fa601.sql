CREATE OR REPLACE FUNCTION public.reschedule_installment_plan(
  p_plan_id uuid,
  p_installment_count integer,
  p_first_due_date date DEFAULT NULL,
  p_frequency text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan installment_plans%ROWTYPE;
  v_paid_count integer;
  v_paid_amount numeric := 0;
  v_remaining numeric;
  v_new_pending integer;
  v_freq text;
  v_start date;
  v_each numeric;
  v_last numeric;
  v_i integer;
  v_no integer;
  v_due date;
  v_step interval;
BEGIN
  SELECT * INTO v_plan FROM installment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Installment plan not found'; END IF;

  IF NOT can_access_restaurant(v_plan.tenant_id) THEN
    RAISE EXCEPTION 'Not authorised to modify this installment plan';
  END IF;

  IF p_installment_count IS NULL OR p_installment_count < 1 THEN
    RAISE EXCEPTION 'Installment count must be at least 1';
  END IF;

  SELECT count(*), COALESCE(sum(paid_amount), 0)
    INTO v_paid_count, v_paid_amount
  FROM installment_payments
  WHERE plan_id = p_plan_id AND status = 'paid' AND voided_at IS NULL;

  IF p_installment_count <= v_paid_count THEN
    RAISE EXCEPTION 'New installment count (%) must be greater than the % already-paid installment(s)',
      p_installment_count, v_paid_count;
  END IF;

  v_freq := COALESCE(p_frequency, v_plan.frequency);
  v_step := CASE v_freq
              WHEN 'weekly' THEN interval '7 days'
              WHEN 'biweekly' THEN interval '14 days'
              ELSE interval '1 month'
            END;
  v_start := COALESCE(p_first_due_date, v_plan.first_due_date);

  v_remaining := ROUND(COALESCE(v_plan.total_payable, 0) - v_paid_amount, 2);
  v_new_pending := p_installment_count - v_paid_count;
  v_each := ROUND(v_remaining / v_new_pending, 2);
  v_last := ROUND(v_remaining - (v_each * (v_new_pending - 1)), 2);

  DELETE FROM installment_payments
  WHERE plan_id = p_plan_id AND status <> 'paid';

  FOR v_i IN 1..v_new_pending LOOP
    v_no := v_paid_count + v_i;
    v_due := (v_start + (v_step * (v_no - 1)))::date;
    INSERT INTO installment_payments (
      tenant_id, plan_id, branch_id, installment_no, due_date, amount,
      paid_amount, status, funding_source
    ) VALUES (
      v_plan.tenant_id, p_plan_id, v_plan.branch_id, v_no, v_due,
      CASE WHEN v_i = v_new_pending THEN v_last ELSE v_each END,
      0, 'pending', 'company'
    );
  END LOOP;

  UPDATE installment_plans
     SET installment_count = p_installment_count,
         first_due_date = v_start,
         frequency = v_freq
   WHERE id = p_plan_id;

  INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    v_plan.tenant_id, auth.uid(), 'installment_plan_rescheduled', 'installment_plan', p_plan_id,
    jsonb_build_object('installment_count', v_plan.installment_count,
                       'first_due_date', v_plan.first_due_date,
                       'frequency', v_plan.frequency),
    jsonb_build_object('installment_count', p_installment_count,
                       'first_due_date', v_start,
                       'frequency', v_freq,
                       'remaining_amount', v_remaining)
  );

  RETURN p_plan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_installment_plan(uuid, integer, date, text) TO authenticated;