
-- 1. Allow authorised propagation of approval across installment siblings
CREATE OR REPLACE FUNCTION public.enforce_fine_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed text[];
  v_is_approver boolean;
  v_propagating boolean := COALESCE(current_setting('app.fine_installment_propagation', true), '') = '1';
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

    IF NEW.status IN ('under_review','approved','rejected') AND NOT v_propagating THEN
      v_is_approver := auth.uid() IS NULL
        OR public.has_role(auth.uid(), NEW.restaurant_id, 'owner'::public.app_role)
        OR public.has_role(auth.uid(), NEW.restaurant_id, 'manager'::public.app_role)
        OR public.has_role(auth.uid(), NEW.restaurant_id, 'accountant'::public.app_role);
      IF NOT v_is_approver THEN
        RAISE EXCEPTION 'FINE_APPROVAL_FORBIDDEN: Only owners, managers or accountants can review, approve or reject fines.';
      END IF;
    END IF;

    IF NEW.status = 'approved'
       AND NOT v_propagating
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
$function$;

-- 2. Approving one installment approves the whole schedule
CREATE OR REPLACE FUNCTION public.propagate_fine_installment_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF NEW.installment_group_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN RETURN NEW; END IF;
  IF COALESCE(current_setting('app.fine_installment_propagation', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(id), '{}') INTO v_ids
  FROM public.employee_fines
  WHERE installment_group_id = NEW.installment_group_id
    AND id <> NEW.id
    AND deleted_at IS NULL
    AND status IN ('draft','submitted','under_review');

  IF COALESCE(array_length(v_ids,1),0) = 0 THEN RETURN NEW; END IF;

  PERFORM set_config('app.fine_installment_propagation', '1', true);

  UPDATE public.employee_fines
  SET status = 'submitted', submitted_at = COALESCE(submitted_at, now())
  WHERE id = ANY(v_ids) AND status = 'draft';

  UPDATE public.employee_fines
  SET status = 'approved',
      approved_at = COALESCE(approved_at, now()),
      approved_by = COALESCE(approved_by, NEW.approved_by)
  WHERE id = ANY(v_ids) AND status IN ('submitted','under_review');

  INSERT INTO public.employee_fine_audit(fine_id, restaurant_id, action, old_status, new_status,
                                         old_amount, new_amount, reason, actor_id, metadata)
  SELECT f.id, f.restaurant_id, 'approved_with_installment_group', 'submitted', 'approved',
         f.amount, f.amount,
         'Approved automatically with installment ' || COALESCE(NEW.installment_number::text,'1')
         || '/' || COALESCE(NEW.installment_count::text,'1'),
         NEW.approved_by,
         jsonb_build_object('installment_group_id', NEW.installment_group_id, 'source_fine_id', NEW.id)
  FROM public.employee_fines f WHERE f.id = ANY(v_ids);

  PERFORM set_config('app.fine_installment_propagation', '0', true);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_propagate_fine_installment_approval ON public.employee_fines;
CREATE TRIGGER trg_propagate_fine_installment_approval
AFTER UPDATE OF status ON public.employee_fines
FOR EACH ROW EXECUTE FUNCTION public.propagate_fine_installment_approval();

-- 3. Payroll picks up due + overdue installments
CREATE OR REPLACE FUNCTION public.preview_payroll_deduction_allocation(p_payroll_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
           'label', COALESCE(f.fine_number,'Fine') || ' — ' || COALESCE(vt.name_en,'Violation')
                    || CASE WHEN f.installment_count > 1
                            THEN ' (inst. ' || f.installment_number || '/' || f.installment_count || ')'
                            ELSE '' END,
           'amount', f.amount,
           'payroll_month', f.payroll_month
         ) ORDER BY f.payroll_month, f.violation_date), '[]'::jsonb),
         COALESCE(SUM(f.amount),0)
  INTO v_fines, v_fine_total
  FROM public.employee_fines f
  LEFT JOIN public.fine_violation_types vt ON vt.id = f.violation_type_id
  WHERE f.staff_id = v_pay.staff_id
    AND f.status = 'approved'
    AND f.deleted_at IS NULL
    AND f.payroll_month <= v_pay.period_end;

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
$function$;

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

  SELECT COALESCE(SUM(amount),0), COALESCE(array_agg(id), '{}')
  INTO v_total, v_ids
  FROM public.employee_fines
  WHERE staff_id = v_pay.staff_id
    AND status = 'approved'
    AND deleted_at IS NULL
    AND payroll_month <= v_pay.period_end;

  UPDATE public.payroll_records SET fines_deducted = v_total WHERE id = p_payroll_id;

  UPDATE public.employee_fines
  SET status = 'applied', applied_payroll_id = p_payroll_id, applied_at = now()
  WHERE id = ANY(v_ids);

  RETURN jsonb_build_object('applied_count', COALESCE(array_length(v_ids,1),0), 'total', v_total);
END;
$function$;
