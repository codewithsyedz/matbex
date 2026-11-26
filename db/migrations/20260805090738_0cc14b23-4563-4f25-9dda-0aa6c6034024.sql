
-- ============ 1. Violation types ============
CREATE TABLE public.fine_violation_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  description text,
  default_amount numeric NOT NULL DEFAULT 0 CHECK (default_amount >= 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fine_violation_types TO authenticated;
GRANT ALL ON public.fine_violation_types TO service_role;
ALTER TABLE public.fine_violation_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View violation types" ON public.fine_violation_types FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));
CREATE POLICY "Managers manage violation types" ON public.fine_violation_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role));
CREATE TRIGGER trg_fvt_updated BEFORE UPDATE ON public.fine_violation_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 2. Effective-dated compliance settings ============
CREATE TABLE public.payroll_deduction_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  max_fine_per_violation numeric NOT NULL DEFAULT 0 CHECK (max_fine_per_violation >= 0),
  max_fine_per_month numeric NOT NULL DEFAULT 0 CHECK (max_fine_per_month >= 0),
  max_days_wage_per_month numeric NOT NULL DEFAULT 5 CHECK (max_days_wage_per_month >= 0),
  max_total_deduction_pct numeric NOT NULL DEFAULT 50 CHECK (max_total_deduction_pct > 0 AND max_total_deduction_pct <= 100),
  requires_second_approval boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, branch_id, effective_from)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_deduction_settings TO authenticated;
GRANT ALL ON public.payroll_deduction_settings TO service_role;
ALTER TABLE public.payroll_deduction_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View deduction settings" ON public.payroll_deduction_settings FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));
CREATE POLICY "Owners manage deduction settings" ON public.payroll_deduction_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role));
CREATE TRIGGER trg_pds_updated BEFORE UPDATE ON public.payroll_deduction_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 3. Employee fines ============
CREATE TABLE public.employee_fines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  fine_number text,
  violation_type_id uuid REFERENCES public.fine_violation_types(id) ON DELETE SET NULL,
  violation_date date NOT NULL DEFAULT CURRENT_DATE,
  payroll_month date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
  description text,
  attendance_reference text,
  amount numeric NOT NULL CHECK (amount > 0),
  original_amount numeric,
  evidence_path text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','under_review','approved','rejected','applied','cancelled')),
  rejection_reason text,
  cancellation_reason text,
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  applied_payroll_id uuid REFERENCES public.payroll_records(id) ON DELETE SET NULL,
  applied_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_employee_fines_scope ON public.employee_fines (restaurant_id, branch_id, payroll_month);
CREATE INDEX idx_employee_fines_staff ON public.employee_fines (staff_id, payroll_month, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_fines TO authenticated;
GRANT ALL ON public.employee_fines TO service_role;
ALTER TABLE public.employee_fines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View fines" ON public.employee_fines FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));
CREATE POLICY "Managers manage fines" ON public.employee_fines FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role));
CREATE TRIGGER trg_ef_updated BEFORE UPDATE ON public.employee_fines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ 4. Fine audit log ============
CREATE TABLE public.employee_fine_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fine_id uuid NOT NULL REFERENCES public.employee_fines(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL,
  action text NOT NULL,
  old_status text,
  new_status text,
  old_amount numeric,
  new_amount numeric,
  reason text,
  actor_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_efa_fine ON public.employee_fine_audit (fine_id, created_at DESC);
GRANT SELECT, INSERT ON public.employee_fine_audit TO authenticated;
GRANT ALL ON public.employee_fine_audit TO service_role;
ALTER TABLE public.employee_fine_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View fine audit" ON public.employee_fine_audit FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));
CREATE POLICY "Insert fine audit" ON public.employee_fine_audit FOR INSERT TO authenticated
  WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- ============ 5. Payroll linkage ============
ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS fines_deducted numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_wage numeric,
  ADD COLUMN IF NOT EXISTS deduction_override_reason text;

-- ============ 6. Settings resolver (effective-date aware) ============
CREATE OR REPLACE FUNCTION public.get_deduction_settings(
  p_restaurant_id uuid, p_branch_id uuid, p_as_of date DEFAULT CURRENT_DATE
) RETURNS public.payroll_deduction_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.payroll_deduction_settings s
  WHERE s.restaurant_id = p_restaurant_id
    AND s.effective_from <= p_as_of
    AND (s.branch_id = p_branch_id OR s.branch_id IS NULL)
  ORDER BY (s.branch_id IS NOT NULL) DESC, s.effective_from DESC
  LIMIT 1;
$$;

-- ============ 7. Monthly wage helper ============
CREATE OR REPLACE FUNCTION public.get_staff_monthly_wage(p_staff_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(COALESCE(s.monthly_salary, 0), COALESCE(s.hourly_rate, 0) * 160)
  FROM public.staff s WHERE s.id = p_staff_id;
$$;

-- ============ 8. Fine capacity calculator ============
CREATE OR REPLACE FUNCTION public.get_employee_fine_capacity(
  p_staff_id uuid, p_payroll_month date, p_exclude_fine_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff public.staff;
  v_set public.payroll_deduction_settings;
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_wage numeric;
  v_existing numeric;
  v_monthly_cap numeric;
  v_days_cap numeric;
  v_advances numeric;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE id = p_staff_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','STAFF_NOT_FOUND'); END IF;

  v_set := public.get_deduction_settings(v_staff.restaurant_id, COALESCE(v_staff.branch_id, v_staff.assigned_branch_id), v_month);
  v_wage := public.get_staff_monthly_wage(p_staff_id);

  SELECT COALESCE(SUM(amount),0) INTO v_existing
  FROM public.employee_fines
  WHERE staff_id = p_staff_id
    AND date_trunc('month', payroll_month)::date = v_month
    AND status IN ('approved','applied')
    AND deleted_at IS NULL
    AND (p_exclude_fine_id IS NULL OR id <> p_exclude_fine_id);

  SELECT COALESCE(SUM(amount),0) INTO v_advances
  FROM public.staff_advances
  WHERE staff_id = p_staff_id AND status = 'pending';

  v_days_cap := CASE WHEN v_set.max_days_wage_per_month IS NULL OR v_wage = 0 THEN NULL
                     ELSE ROUND(v_wage / 30.0 * v_set.max_days_wage_per_month, 2) END;
  v_monthly_cap := NULLIF(COALESCE(v_set.max_fine_per_month, 0), 0);
  v_monthly_cap := LEAST(COALESCE(v_monthly_cap, v_days_cap, 0), COALESCE(v_days_cap, v_monthly_cap, 0));

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'payroll_month', v_month,
    'monthly_wage', v_wage,
    'max_fine_per_violation', COALESCE(v_set.max_fine_per_violation, 0),
    'max_days_wage_per_month', COALESCE(v_set.max_days_wage_per_month, 0),
    'max_total_deduction_pct', COALESCE(v_set.max_total_deduction_pct, 50),
    'monthly_fine_limit', COALESCE(v_monthly_cap, 0),
    'existing_fines', v_existing,
    'remaining_fine_capacity', GREATEST(COALESCE(v_monthly_cap,0) - v_existing, 0),
    'max_total_deduction', ROUND(v_wage * COALESCE(v_set.max_total_deduction_pct, 50) / 100.0, 2),
    'pending_advances', v_advances,
    'settings_effective_from', v_set.effective_from
  );
END;
$$;

-- ============ 9. Approval validation trigger ============
CREATE OR REPLACE FUNCTION public.validate_employee_fine()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap jsonb;
  v_single numeric;
  v_remaining numeric;
BEGIN
  IF NEW.status IN ('approved','applied')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.amount IS DISTINCT FROM NEW.amount) THEN
    v_cap := public.get_employee_fine_capacity(NEW.staff_id, NEW.payroll_month, NEW.id);
    v_single := COALESCE((v_cap->>'max_fine_per_violation')::numeric, 0);
    v_remaining := COALESCE((v_cap->>'remaining_fine_capacity')::numeric, 0);

    IF v_single > 0 AND NEW.amount > v_single THEN
      RAISE EXCEPTION 'FINE_LIMIT_EXCEEDED: Single fine % exceeds the configured maximum of % per violation.', NEW.amount, v_single
        USING ERRCODE = 'check_violation';
    END IF;

    IF COALESCE((v_cap->>'monthly_fine_limit')::numeric, 0) > 0 AND NEW.amount > v_remaining THEN
      RAISE EXCEPTION 'MONTHLY_FINE_LIMIT_EXCEEDED: Fine % exceeds the remaining monthly capacity of % (limit %, already fined %).',
        NEW.amount, v_remaining, (v_cap->>'monthly_fine_limit'), (v_cap->>'existing_fines')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'applied' AND NEW.status <> 'applied' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'FINE_ALREADY_APPLIED: An applied fine can only be cancelled with a reason.';
  END IF;

  IF NEW.status = 'cancelled' AND COALESCE(NEW.cancellation_reason,'') = '' THEN
    RAISE EXCEPTION 'CANCELLATION_REASON_REQUIRED: A reason is mandatory when cancelling a fine.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.original_amount := COALESCE(NEW.original_amount, NEW.amount);
    NEW.fine_number := COALESCE(NEW.fine_number, 'FIN-' || to_char(now(),'YYMM') || '-' || upper(substr(replace(NEW.id::text,'-',''),1,6)));
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_employee_fine BEFORE INSERT OR UPDATE ON public.employee_fines
  FOR EACH ROW EXECUTE FUNCTION public.validate_employee_fine();

-- ============ 10. Audit trigger ============
CREATE OR REPLACE FUNCTION public.log_employee_fine_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.employee_fine_audit (fine_id, restaurant_id, action, new_status, new_amount, actor_id)
    VALUES (NEW.id, NEW.restaurant_id, 'created', NEW.status, NEW.amount, auth.uid());
  ELSE
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO public.employee_fine_audit (fine_id, restaurant_id, action, old_status, new_status, old_amount, new_amount, reason, actor_id)
      VALUES (NEW.id, NEW.restaurant_id, 'status_change', OLD.status, NEW.status, OLD.amount, NEW.amount,
              COALESCE(NEW.rejection_reason, NEW.cancellation_reason), auth.uid());
    END IF;
    IF OLD.amount IS DISTINCT FROM NEW.amount THEN
      INSERT INTO public.employee_fine_audit (fine_id, restaurant_id, action, old_status, new_status, old_amount, new_amount, actor_id)
      VALUES (NEW.id, NEW.restaurant_id, 'amount_changed', OLD.status, NEW.status, OLD.amount, NEW.amount, auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_log_employee_fine_audit AFTER INSERT OR UPDATE ON public.employee_fines
  FOR EACH ROW EXECUTE FUNCTION public.log_employee_fine_audit();

-- ============ 11. Payroll 50% compliance enforcement ============
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
  v_gross := COALESCE(NULLIF(NEW.gross_wage,0), NEW.amount + v_total);
  v_max := ROUND(v_gross * v_pct / 100.0, 2);

  IF v_gross > 0 AND v_total > v_max + 0.01 THEN
    RAISE EXCEPTION 'DEDUCTION_LIMIT_EXCEEDED: Total deductions % exceed the maximum permitted % which is % percent of the due wage %. Excess: %',
      v_total, v_max, v_pct, v_gross, ROUND(v_total - v_max, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enforce_payroll_deduction_cap BEFORE INSERT OR UPDATE ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_deduction_cap();

-- ============ 12. Apply approved fines to a payroll record ============
CREATE OR REPLACE FUNCTION public.apply_fines_to_payroll(p_payroll_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pay public.payroll_records;
  v_total numeric := 0;
  v_ids uuid[];
BEGIN
  SELECT * INTO v_pay FROM public.payroll_records WHERE id = p_payroll_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_NOT_FOUND'; END IF;

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

-- ============ 13. Seed default violation types + settings for existing restaurants ============
INSERT INTO public.fine_violation_types (restaurant_id, code, name_en, name_ar, sort_order)
SELECT r.id, v.code, v.en, v.ar, v.ord
FROM public.restaurants r
CROSS JOIN (VALUES
  ('unexcused_absence','Unexcused Absence','غياب بدون عذر',1),
  ('tardiness','Tardiness / Late Arrival','تأخر عن العمل',2),
  ('early_departure','Early Departure','مغادرة مبكرة',3),
  ('policy_violation','Policy Violation','مخالفة لائحة',4),
  ('other','Other','أخرى',5)
) AS v(code,en,ar,ord)
ON CONFLICT (restaurant_id, code) DO NOTHING;

INSERT INTO public.payroll_deduction_settings (restaurant_id, branch_id, effective_from, max_fine_per_violation, max_fine_per_month, max_days_wage_per_month, max_total_deduction_pct)
SELECT r.id, NULL, '2000-01-01'::date, 0, 0, 5, 50 FROM public.restaurants r
ON CONFLICT DO NOTHING;
