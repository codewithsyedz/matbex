CREATE TABLE IF NOT EXISTS public.payroll_deduction_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  branch_id uuid,
  payroll_id uuid NOT NULL REFERENCES public.payroll_records(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL,
  gross_wage numeric NOT NULL DEFAULT 0,
  max_deduction_pct numeric NOT NULL DEFAULT 50,
  max_deduction numeric NOT NULL DEFAULT 0,
  requested_total numeric NOT NULL DEFAULT 0,
  excess_amount numeric NOT NULL DEFAULT 0,
  allocated_total numeric NOT NULL DEFAULT 0,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.payroll_deduction_allocations TO authenticated;
GRANT ALL ON public.payroll_deduction_allocations TO service_role;
ALTER TABLE public.payroll_deduction_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read deduction allocations" ON public.payroll_deduction_allocations;
CREATE POLICY "Tenant members read deduction allocations"
ON public.payroll_deduction_allocations FOR SELECT TO authenticated
USING (public.can_access_restaurant(restaurant_id));

DROP POLICY IF EXISTS "Authorized users record deduction allocations" ON public.payroll_deduction_allocations;
CREATE POLICY "Authorized users record deduction allocations"
ON public.payroll_deduction_allocations FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_restaurant(restaurant_id)
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::public.app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::public.app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'accountant'::public.app_role)
  )
);

CREATE INDEX IF NOT EXISTS idx_pda_payroll ON public.payroll_deduction_allocations(payroll_id);

DROP TRIGGER IF EXISTS trg_pda_updated_at ON public.payroll_deduction_allocations;
CREATE TRIGGER trg_pda_updated_at BEFORE UPDATE ON public.payroll_deduction_allocations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.preview_payroll_deduction_allocation(p_payroll_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.payroll_records;
  v_set public.payroll_deduction_settings;
  v_branch uuid;
  v_pct numeric;
  v_gross numeric;
  v_max numeric;
  v_fines jsonb := '[]'::jsonb;
  v_fine_total numeric := 0;
  v_total numeric;
BEGIN
  SELECT * INTO v_pay FROM public.payroll_records WHERE id = p_payroll_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;

  SELECT COALESCE(v_pay.branch_id, s.branch_id, s.assigned_branch_id) INTO v_branch
  FROM public.staff s WHERE s.id = v_pay.staff_id;

  v_set := public.get_deduction_settings(v_pay.restaurant_id, v_branch, v_pay.period_end);
  v_pct := COALESCE(v_set.max_total_deduction_pct, 50);
  v_gross := COALESCE(NULLIF(v_pay.gross_wage,0), v_pay.amount, 0);
  v_max := ROUND(v_gross * v_pct / 100.0, 2);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind','fine',
           'id', f.id,
           'label', COALESCE(f.fine_number,'Fine') || ' — ' || COALESCE(vt.name_en,'Violation'),
           'amount', f.amount,
           'payroll_month', f.payroll_month
         ) ORDER BY f.violation_date), '[]'::jsonb),
         COALESCE(SUM(f.amount),0)
  INTO v_fines, v_fine_total
  FROM public.employee_fines f
  LEFT JOIN public.fine_violation_types vt ON vt.id = f.violation_type_id
  WHERE f.staff_id = v_pay.staff_id
    AND f.status = 'approved'
    AND f.deleted_at IS NULL
    AND f.payroll_month BETWEEN date_trunc('month', v_pay.period_start)::date AND v_pay.period_end;

  v_total := COALESCE(v_pay.deductions,0) + COALESCE(v_pay.advance_recovered,0) + v_fine_total;

  RETURN jsonb_build_object(
    'payroll_id', p_payroll_id,
    'staff_id', v_pay.staff_id,
    'branch_id', v_branch,
    'gross_wage', v_gross,
    'max_deduction_pct', v_pct,
    'max_deduction', v_max,
    'other_deductions', COALESCE(v_pay.deductions,0),
    'advance_recovered', COALESCE(v_pay.advance_recovered,0),
    'fines_total', v_fine_total,
    'requested_total', v_total,
    'excess_amount', GREATEST(ROUND(v_total - v_max, 2), 0),
    'requires_allocation', (v_gross > 0 AND v_total > v_max + 0.01),
    'fines', v_fines
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_payroll_deduction_allocation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_payroll_deduction_allocation(
  p_payroll_id uuid,
  p_decisions jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.payroll_records;
  v_preview jsonb;
  v_d jsonb;
  v_fine public.employee_fines;
  v_to_month date;
  v_kept numeric := 0;
  v_kept_ids uuid[] := '{}';
  v_advance numeric;
  v_other numeric;
  v_total numeric;
  v_max numeric;
BEGIN
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'ALLOCATION_REASON_REQUIRED: A written justification is mandatory when allocating deductions.';
  END IF;

  SELECT * INTO v_pay FROM public.payroll_records WHERE id = p_payroll_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;

  IF auth.uid() IS NOT NULL AND NOT (
       public.has_role(auth.uid(), v_pay.restaurant_id, 'owner'::public.app_role)
    OR public.has_role(auth.uid(), v_pay.restaurant_id, 'manager'::public.app_role)
    OR public.has_role(auth.uid(), v_pay.restaurant_id, 'accountant'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'ALLOCATION_FORBIDDEN: Only owners, managers or accountants can allocate deductions.';
  END IF;

  v_preview := public.preview_payroll_deduction_allocation(p_payroll_id);
  v_max := (v_preview->>'max_deduction')::numeric;
  v_other := COALESCE(v_pay.deductions,0);
  v_advance := COALESCE(v_pay.advance_recovered,0);

  FOR v_d IN SELECT * FROM jsonb_array_elements(COALESCE(p_decisions,'[]'::jsonb))
  LOOP
    IF v_d->>'kind' = 'fine' THEN
      SELECT * INTO v_fine FROM public.employee_fines WHERE id = (v_d->>'id')::uuid;
      CONTINUE WHEN NOT FOUND;

      IF v_d->>'action' = 'defer' THEN
        v_to_month := COALESCE((v_d->>'defer_to')::date,
                               (date_trunc('month', v_fine.payroll_month) + interval '1 month')::date);

        UPDATE public.employee_fines SET payroll_month = v_to_month WHERE id = v_fine.id;

        INSERT INTO public.employee_fine_audit(fine_id, restaurant_id, action, old_status, new_status,
                                               old_amount, new_amount, reason, actor_id, metadata)
        VALUES (v_fine.id, v_fine.restaurant_id, 'deferred_by_allocation', v_fine.status, v_fine.status,
                v_fine.amount, v_fine.amount, p_reason, auth.uid(),
                jsonb_build_object('payroll_id', p_payroll_id,
                                   'from_month', v_fine.payroll_month,
                                   'to_month', v_to_month));
      ELSE
        v_kept := v_kept + v_fine.amount;
        v_kept_ids := array_append(v_kept_ids, v_fine.id);
      END IF;

    ELSIF v_d->>'kind' = 'advance' THEN
      v_advance := LEAST(v_advance, GREATEST(COALESCE((v_d->>'amount')::numeric, v_advance), 0));

    ELSIF v_d->>'kind' = 'other' THEN
      v_other := LEAST(v_other, GREATEST(COALESCE((v_d->>'amount')::numeric, v_other), 0));
    END IF;
  END LOOP;

  v_total := v_other + v_advance + v_kept;
  IF v_total > v_max + 0.01 THEN
    RAISE EXCEPTION 'ALLOCATION_STILL_EXCEEDS: The selected deductions total % but the permitted maximum is %. Defer or reduce % more.',
      ROUND(v_total,2), ROUND(v_max,2), ROUND(v_total - v_max, 2);
  END IF;

  UPDATE public.payroll_records
  SET deductions = v_other,
      advance_recovered = v_advance,
      fines_deducted = v_kept,
      deduction_override_reason = p_reason
  WHERE id = p_payroll_id;

  IF array_length(v_kept_ids,1) > 0 THEN
    UPDATE public.employee_fines
    SET status = 'applied', applied_payroll_id = p_payroll_id, applied_at = now()
    WHERE id = ANY(v_kept_ids);
  END IF;

  INSERT INTO public.payroll_deduction_allocations(
    restaurant_id, branch_id, payroll_id, staff_id, gross_wage, max_deduction_pct, max_deduction,
    requested_total, excess_amount, allocated_total, decisions, reason, decided_by)
  VALUES (
    v_pay.restaurant_id, (v_preview->>'branch_id')::uuid, p_payroll_id, v_pay.staff_id,
    (v_preview->>'gross_wage')::numeric, (v_preview->>'max_deduction_pct')::numeric, v_max,
    (v_preview->>'requested_total')::numeric, (v_preview->>'excess_amount')::numeric,
    v_total, COALESCE(p_decisions,'[]'::jsonb), p_reason, auth.uid());

  RETURN jsonb_build_object('allocated_total', v_total, 'fines_applied', COALESCE(array_length(v_kept_ids,1),0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_payroll_deduction_allocation(uuid, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_fines_to_payroll(p_payroll_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT COALESCE(SUM(amount),0), COALESCE(array_agg(id), '{}')
  INTO v_total, v_ids
  FROM public.employee_fines
  WHERE staff_id = v_pay.staff_id
    AND status = 'approved'
    AND deleted_at IS NULL
    AND payroll_month BETWEEN date_trunc('month', v_pay.period_start)::date AND v_pay.period_end;

  UPDATE public.payroll_records SET fines_deducted = v_total WHERE id = p_payroll_id;

  UPDATE public.employee_fines
  SET status = 'applied', applied_payroll_id = p_payroll_id, applied_at = now()
  WHERE id = ANY(v_ids);

  RETURN jsonb_build_object('applied_count', COALESCE(array_length(v_ids,1),0), 'total', v_total);
END;
$$;

-- Fix role checks in the fine approval trigger (has_role requires the restaurant id)
CREATE OR REPLACE FUNCTION public.enforce_fine_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[];
  v_is_approver boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_allowed := CASE OLD.status
      WHEN 'draft'        THEN ARRAY['submitted','cancelled']
      WHEN 'submitted'    THEN ARRAY['under_review','approved','rejected','cancelled']
      WHEN 'under_review' THEN ARRAY['approved','rejected','cancelled']
      WHEN 'approved'     THEN ARRAY['applied','cancelled']
      WHEN 'rejected'     THEN ARRAY['draft','cancelled']
      WHEN 'applied'      THEN ARRAY['cancelled']
      WHEN 'cancelled'    THEN ARRAY[]::text[]
      ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.status = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'INVALID_FINE_TRANSITION: A fine cannot move from % to %.', OLD.status, NEW.status;
    END IF;

    IF NEW.status IN ('under_review','approved','rejected') THEN
      v_is_approver := auth.uid() IS NULL
        OR public.has_role(auth.uid(), NEW.restaurant_id, 'owner'::public.app_role)
        OR public.has_role(auth.uid(), NEW.restaurant_id, 'manager'::public.app_role)
        OR public.has_role(auth.uid(), NEW.restaurant_id, 'accountant'::public.app_role);
      IF NOT v_is_approver THEN
        RAISE EXCEPTION 'FINE_APPROVAL_FORBIDDEN: Only owners, managers or accountants can review, approve or reject fines.';
      END IF;
    END IF;

    IF NEW.status = 'approved'
       AND auth.uid() IS NOT NULL
       AND OLD.created_by = auth.uid()
       AND NOT public.has_role(auth.uid(), NEW.restaurant_id, 'owner'::public.app_role) THEN
      RAISE EXCEPTION 'FINE_SELF_APPROVAL_FORBIDDEN: You cannot approve a fine you created. Ask another approver to review it.';
    END IF;

    IF NEW.status = 'rejected' AND COALESCE(btrim(NEW.rejection_reason), '') = '' THEN
      RAISE EXCEPTION 'REJECTION_REASON_REQUIRED: A written reason is mandatory when rejecting a fine.';
    END IF;

    IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := now(); END IF;
    IF NEW.status = 'under_review' AND NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
      NEW.reviewed_by := COALESCE(NEW.reviewed_by, auth.uid());
    END IF;
    IF NEW.status = 'approved' THEN
      NEW.approved_at := COALESCE(NEW.approved_at, now());
      NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
    END IF;
    IF NEW.status = 'draft' THEN
      NEW.submitted_at := NULL; NEW.reviewed_at := NULL; NEW.reviewed_by := NULL;
      NEW.approved_at := NULL; NEW.approved_by := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;