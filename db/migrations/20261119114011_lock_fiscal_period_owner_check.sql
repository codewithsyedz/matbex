-- lock_fiscal_period runs as SECURITY DEFINER but never checked the caller: any signed-in user
-- could lock a month for any restaurant (of any business) by passing its id, and postings for
-- that business were then refused. Locking now needs the same rights as unlocking (owner of the
-- restaurant's business, or superadmin), matching the table's own RLS policies.
-- Lock scope (per restaurant vs whole business) is unchanged here.

CREATE OR REPLACE FUNCTION public.lock_fiscal_period(
  p_restaurant_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant_id UUID;
  v_lock_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.restaurants WHERE id = p_restaurant_id;

  -- Same message whether the restaurant is missing or belongs to someone else, so the
  -- function cannot be used to probe other businesses' restaurant ids.
  IF v_tenant_id IS NULL
     OR NOT (public.has_tenant_role(v_uid, v_tenant_id, 'owner') OR public.is_superadmin(v_uid)) THEN
    RAISE EXCEPTION 'Only owners can lock fiscal periods' USING ERRCODE = '42501';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Invalid period' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.fiscal_period_locks
    WHERE restaurant_id = p_restaurant_id
      AND period_start = p_period_start
      AND period_end = p_period_end
      AND is_locked = TRUE
  ) THEN
    RAISE EXCEPTION 'This period is already locked';
  END IF;

  INSERT INTO public.fiscal_period_locks (
    tenant_id, restaurant_id, period_start, period_end, locked_by
  ) VALUES (
    v_tenant_id, p_restaurant_id, p_period_start, p_period_end, v_uid
  )
  ON CONFLICT (restaurant_id, period_start, period_end)
  DO UPDATE SET
    is_locked = TRUE,
    locked_at = now(),
    locked_by = v_uid,
    unlocked_at = NULL,
    unlocked_by = NULL
  RETURNING id INTO v_lock_id;

  PERFORM public.log_audit(
    'PERIOD_LOCKED',
    'fiscal_period_lock',
    v_lock_id,
    NULL,
    jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end),
    v_tenant_id
  );

  RETURN v_lock_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_fiscal_period(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_fiscal_period(uuid, date, date) TO authenticated;
