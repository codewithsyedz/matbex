CREATE TABLE public.payroll_period_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  branch_id uuid NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'locked',
  notes text,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX payroll_period_locks_unique
  ON public.payroll_period_locks (restaurant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_period_locks TO authenticated;
GRANT ALL ON public.payroll_period_locks TO service_role;

ALTER TABLE public.payroll_period_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view payroll period locks"
ON public.payroll_period_locks FOR SELECT TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Owners and managers can create payroll period locks"
ON public.payroll_period_locks FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_restaurant(restaurant_id)
  AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role) OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
);

CREATE POLICY "Owners can update payroll period locks"
ON public.payroll_period_locks FOR UPDATE TO authenticated
USING (public.can_access_restaurant(restaurant_id) AND public.has_role(auth.uid(), restaurant_id, 'owner'::app_role))
WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Owners can delete payroll period locks"
ON public.payroll_period_locks FOR DELETE TO authenticated
USING (public.can_access_restaurant(restaurant_id) AND public.has_role(auth.uid(), restaurant_id, 'owner'::app_role));

CREATE TRIGGER trg_payroll_period_locks_updated_at
BEFORE UPDATE ON public.payroll_period_locks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enforce_payroll_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  lock_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN rec := OLD; ELSE rec := NEW; END IF;

  SELECT * INTO lock_row
  FROM public.payroll_period_locks l
  WHERE l.restaurant_id = rec.restaurant_id
    AND l.status = 'locked'
    AND (l.branch_id IS NULL OR l.branch_id IS NOT DISTINCT FROM rec.branch_id)
    AND rec.period_start >= l.period_start
    AND rec.period_end <= l.period_end
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Payroll period % to % is locked (approved on %). Unlock it before changing payroll records.',
      lock_row.period_start, lock_row.period_end, lock_row.approved_at::date
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_payroll_period_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_records
FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_period_lock();