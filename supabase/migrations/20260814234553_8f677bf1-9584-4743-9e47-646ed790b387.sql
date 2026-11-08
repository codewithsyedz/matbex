CREATE OR REPLACE FUNCTION public.list_advance_branch_mismatches()
RETURNS TABLE (
  advance_id uuid,
  staff_id uuid,
  staff_name text,
  advance_date date,
  amount numeric,
  status text,
  advance_branch_id uuid,
  advance_branch_name text,
  staff_branch_id uuid,
  staff_branch_name text,
  ledger_leg_count integer,
  mismatched_leg_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    a.id,
    s.id,
    s.name,
    a.advance_date,
    a.amount,
    a.status::text,
    a.branch_id,
    ab.name,
    s.branch_id,
    sb.name,
    (SELECT count(*)::int FROM public.account_transactions t
       WHERE t.reference_id = a.id
         AND t.reference_type IN ('staff_advance','staff_advance_reversal','staff_advance_repayment','advance_deduction')),
    (SELECT count(*)::int FROM public.account_transactions t
       WHERE t.reference_id = a.id
         AND t.reference_type IN ('staff_advance','staff_advance_reversal','staff_advance_repayment','advance_deduction')
         AND t.branch_id IS DISTINCT FROM a.branch_id)
  FROM public.staff_advances a
  JOIN public.staff s ON s.id = a.staff_id
  LEFT JOIN public.branches ab ON ab.id = a.branch_id
  LEFT JOIN public.branches sb ON sb.id = s.branch_id
  WHERE a.branch_id IS NOT NULL
    AND s.branch_id IS NOT NULL
    AND a.branch_id <> s.branch_id
  ORDER BY a.advance_date DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_advance_branch_mismatches() TO authenticated;

CREATE OR REPLACE FUNCTION public.realign_advance_branch(p_advance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN jsonb_build_object(
    'changed', true,
    'from_branch_id', v_adv.branch_id,
    'branch_id', v_staff_branch,
    'legs_updated', v_legs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.realign_advance_branch(uuid) TO authenticated;