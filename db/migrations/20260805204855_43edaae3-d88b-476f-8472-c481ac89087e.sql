DROP FUNCTION IF EXISTS public.reschedule_installment_plan(uuid, integer, date, text);

CREATE OR REPLACE FUNCTION public.reschedule_installment_plan(
  p_plan_id uuid,
  p_installment_count integer,
  p_first_due_date date DEFAULT NULL,
  p_frequency text DEFAULT NULL,
  p_finance_charge numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.installment_plans%ROWTYPE;
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
  v_new_fee numeric(15,2);
  v_new_fee_vat numeric(15,2);
  v_new_total numeric(15,2);
  v_delta_fee numeric(15,2);
  v_delta_fee_vat numeric(15,2);
  v_delta_total numeric(15,2);
  v_adjustment_batch uuid;
  v_description text;
BEGIN
  SELECT * INTO v_plan
  FROM public.installment_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Installment plan not found'; END IF;
  IF NOT public.can_access_restaurant(v_plan.tenant_id) THEN
    RAISE EXCEPTION 'Not authorised to modify this installment plan';
  END IF;
  IF p_installment_count IS NULL OR p_installment_count < 1 THEN
    RAISE EXCEPTION 'Installment count must be at least 1';
  END IF;

  SELECT count(*), COALESCE(sum(paid_amount), 0)
  INTO v_paid_count, v_paid_amount
  FROM public.installment_payments
  WHERE plan_id = p_plan_id AND status = 'paid' AND voided_at IS NULL;

  IF p_installment_count <= v_paid_count THEN
    RAISE EXCEPTION 'New installment count (%) must be greater than the % already-paid installment(s)',
      p_installment_count, v_paid_count;
  END IF;

  v_new_fee := ROUND(COALESCE(p_finance_charge, v_plan.finance_charge, 0), 2);
  IF v_new_fee < 0 THEN RAISE EXCEPTION 'Finance charge cannot be negative'; END IF;
  v_new_fee_vat := CASE
    WHEN COALESCE(v_plan.vat_on_finance_charge, false)
      THEN ROUND(v_new_fee * COALESCE(v_plan.vat_rate, 0) / 100.0, 2)
    ELSE 0
  END;
  v_new_total := ROUND(COALESCE(v_plan.cash_price, 0) + COALESCE(v_plan.vat_amount, 0) + v_new_fee + v_new_fee_vat, 2);
  v_delta_fee := ROUND(v_new_fee - COALESCE(v_plan.finance_charge, 0), 2);
  v_delta_fee_vat := ROUND(v_new_fee_vat - COALESCE(v_plan.finance_vat_amount, 0), 2);
  v_delta_total := ROUND(v_new_total - COALESCE(v_plan.total_payable, 0), 2);

  IF v_new_total < v_paid_amount THEN
    RAISE EXCEPTION 'Revised total payable cannot be less than the amount already paid';
  END IF;

  IF v_delta_total <> 0 THEN
    v_description := 'Installment finance charge adjustment - ' || v_plan.description;
    INSERT INTO public.journal_entry_batches
      (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
       created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
    VALUES
      (v_plan.tenant_id, CURRENT_DATE, v_description,
       'INST-ADJ-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
       'adjustment', 'adjustment', auth.uid(), true, now(), auth.uid(),
       'approved', auth.uid(), now(), v_plan.branch_id)
    RETURNING id INTO v_adjustment_batch;

    IF v_delta_total > 0 THEN
      IF v_delta_fee > 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit, description,
           reference_type, reference_id, created_by, batch_id, branch_id)
        VALUES
          (v_plan.tenant_id, v_plan.finance_account_id, CURRENT_DATE, v_delta_fee, 0,
           v_description, 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      END IF;
      IF v_delta_fee_vat > 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit, description,
           reference_type, reference_id, created_by, batch_id, branch_id)
        VALUES
          (v_plan.tenant_id, v_plan.vat_account_id, CURRENT_DATE, v_delta_fee_vat, 0,
           v_description || ' - input VAT', 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      END IF;
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, debit, credit, description,
         reference_type, reference_id, created_by, batch_id, branch_id)
      VALUES
        (v_plan.tenant_id, v_plan.liability_account_id, CURRENT_DATE, 0, v_delta_total,
         v_description, 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
    ELSE
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, debit, credit, description,
         reference_type, reference_id, created_by, batch_id, branch_id)
      VALUES
        (v_plan.tenant_id, v_plan.liability_account_id, CURRENT_DATE, ABS(v_delta_total), 0,
         v_description, 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      IF v_delta_fee < 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit, description,
           reference_type, reference_id, created_by, batch_id, branch_id)
        VALUES
          (v_plan.tenant_id, v_plan.finance_account_id, CURRENT_DATE, 0, ABS(v_delta_fee),
           v_description, 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      END IF;
      IF v_delta_fee_vat < 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit, description,
           reference_type, reference_id, created_by, batch_id, branch_id)
        VALUES
          (v_plan.tenant_id, v_plan.vat_account_id, CURRENT_DATE, 0, ABS(v_delta_fee_vat),
           v_description || ' - input VAT', 'installment_plan', v_plan.id, auth.uid(), v_adjustment_batch, v_plan.branch_id);
      END IF;
    END IF;
  END IF;

  v_freq := COALESCE(p_frequency, v_plan.frequency);
  v_step := CASE v_freq WHEN 'weekly' THEN interval '7 days' WHEN 'biweekly' THEN interval '14 days' ELSE interval '1 month' END;
  v_start := COALESCE(p_first_due_date, v_plan.first_due_date);
  v_remaining := ROUND(v_new_total - v_paid_amount, 2);
  v_new_pending := p_installment_count - v_paid_count;
  v_each := ROUND(v_remaining / v_new_pending, 2);
  v_last := ROUND(v_remaining - (v_each * (v_new_pending - 1)), 2);

  DELETE FROM public.installment_payments
  WHERE plan_id = p_plan_id AND status <> 'paid';

  FOR v_i IN 1..v_new_pending LOOP
    v_no := v_paid_count + v_i;
    v_due := (v_start + (v_step * (v_no - 1)))::date;
    INSERT INTO public.installment_payments
      (tenant_id, plan_id, branch_id, installment_no, due_date, amount, paid_amount, status, funding_source)
    VALUES
      (v_plan.tenant_id, p_plan_id, v_plan.branch_id, v_no, v_due,
       CASE WHEN v_i = v_new_pending THEN v_last ELSE v_each END, 0, 'pending', 'company');
  END LOOP;

  UPDATE public.installment_plans
  SET installment_count = p_installment_count,
      first_due_date = v_start,
      frequency = v_freq,
      finance_charge = v_new_fee,
      finance_vat_amount = v_new_fee_vat,
      total_payable = v_new_total
  WHERE id = p_plan_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    v_plan.tenant_id, auth.uid(), 'installment_plan_rescheduled', 'installment_plan', p_plan_id,
    jsonb_build_object('installment_count', v_plan.installment_count, 'first_due_date', v_plan.first_due_date,
      'frequency', v_plan.frequency, 'finance_charge', v_plan.finance_charge, 'total_payable', v_plan.total_payable),
    jsonb_build_object('installment_count', p_installment_count, 'first_due_date', v_start,
      'frequency', v_freq, 'finance_charge', v_new_fee, 'total_payable', v_new_total,
      'remaining_amount', v_remaining, 'adjustment_batch_id', v_adjustment_batch)
  );

  RETURN p_plan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_installment_plan(uuid, integer, date, text, numeric) TO authenticated;