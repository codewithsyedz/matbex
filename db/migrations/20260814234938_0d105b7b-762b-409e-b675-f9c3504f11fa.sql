CREATE TABLE public.staff_advance_branch_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  restaurant_id uuid,
  advance_id uuid NOT NULL,
  staff_id uuid,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  old_branch_id uuid,
  new_branch_id uuid,
  ledger_legs_updated integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual_update',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sab_audit_advance ON public.staff_advance_branch_audit(advance_id, changed_at DESC);
CREATE INDEX idx_sab_audit_restaurant ON public.staff_advance_branch_audit(restaurant_id, changed_at DESC);

GRANT SELECT ON public.staff_advance_branch_audit TO authenticated;
GRANT ALL ON public.staff_advance_branch_audit TO service_role;

ALTER TABLE public.staff_advance_branch_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff advance branch audit readable by restaurant staff"
ON public.staff_advance_branch_audit
FOR SELECT
TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE OR REPLACE FUNCTION public.log_staff_advance_branch_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    INSERT INTO public.staff_advance_branch_audit (
      tenant_id, restaurant_id, advance_id, staff_id, changed_by,
      old_branch_id, new_branch_id, source
    ) VALUES (
      NEW.tenant_id, NEW.restaurant_id, NEW.id, NEW.staff_id, auth.uid(),
      OLD.branch_id, NEW.branch_id, 'manual_update'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_staff_advance_branch_change ON public.staff_advances;
CREATE TRIGGER trg_log_staff_advance_branch_change
AFTER UPDATE OF branch_id ON public.staff_advances
FOR EACH ROW
EXECUTE FUNCTION public.log_staff_advance_branch_change();

CREATE OR REPLACE FUNCTION public.realign_advance_branch(p_advance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_adv record;
  v_staff_branch uuid;
  v_legs int;
BEGIN
  SELECT a.* INTO v_adv FROM public.staff_advances a WHERE a.id = p_advance_id;
  IF v_adv.id IS NULL THEN
    RAISE EXCEPTION 'Advance not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'owner'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only owners or managers can realign an advance branch';
  END IF;

  IF NOT public.can_access_restaurant(v_adv.restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised for this restaurant';
  END IF;

  SELECT s.branch_id INTO v_staff_branch FROM public.staff s WHERE s.id = v_adv.staff_id;
  IF v_staff_branch IS NULL THEN
    RAISE EXCEPTION 'Staff member has no branch assigned';
  END IF;

  IF v_staff_branch = v_adv.branch_id THEN
    RETURN jsonb_build_object('changed', false, 'branch_id', v_staff_branch, 'legs_updated', 0);
  END IF;

  UPDATE public.staff_advances
     SET branch_id = v_staff_branch
   WHERE id = p_advance_id;

  UPDATE public.account_transactions
     SET branch_id = v_staff_branch
   WHERE reference_id = p_advance_id
     AND reference_type IN ('staff_advance','staff_advance_reversal','staff_advance_repayment','advance_deduction')
     AND branch_id IS DISTINCT FROM v_staff_branch;
  GET DIAGNOSTICS v_legs = ROW_COUNT;

  UPDATE public.staff_advance_branch_audit
     SET ledger_legs_updated = v_legs,
         source = 'realign_rpc',
         note = 'Realigned to staff profile branch'
   WHERE id = (
     SELECT id FROM public.staff_advance_branch_audit
      WHERE advance_id = p_advance_id
      ORDER BY changed_at DESC
      LIMIT 1
   );

  RETURN jsonb_build_object(
    'changed', true,
    'from_branch_id', v_adv.branch_id,
    'branch_id', v_staff_branch,
    'legs_updated', v_legs
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_advance_branch_audit(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  advance_id uuid,
  staff_id uuid,
  staff_name text,
  advance_date date,
  amount numeric,
  changed_at timestamptz,
  changed_by uuid,
  changed_by_name text,
  old_branch_id uuid,
  old_branch_name text,
  new_branch_id uuid,
  new_branch_name text,
  ledger_legs_updated integer,
  source text,
  note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    a.id,
    a.advance_id,
    a.staff_id,
    s.name,
    adv.advance_date,
    adv.amount,
    a.changed_at,
    a.changed_by,
    p.full_name,
    a.old_branch_id,
    ob.name,
    a.new_branch_id,
    nb.name,
    a.ledger_legs_updated,
    a.source,
    a.note
  FROM public.staff_advance_branch_audit a
  LEFT JOIN public.staff s ON s.id = a.staff_id
  LEFT JOIN public.staff_advances adv ON adv.id = a.advance_id
  LEFT JOIN public.profiles p ON p.id = a.changed_by
  LEFT JOIN public.branches ob ON ob.id = a.old_branch_id
  LEFT JOIN public.branches nb ON nb.id = a.new_branch_id
  WHERE public.can_access_restaurant(a.restaurant_id)
  ORDER BY a.changed_at DESC
  LIMIT COALESCE(p_limit, 50);
$$;