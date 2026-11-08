CREATE OR REPLACE FUNCTION public.request_terminal_state_refresh(
  _restaurant_id uuid,
  _branch_id uuid DEFAULT NULL,
  _terminal_uid text DEFAULT NULL
)
RETURNS TABLE(branch_id uuid, menu_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_tenant_roles utr
    WHERE utr.user_id = v_uid
      AND utr.restaurant_id = _restaurant_id
      AND utr.role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Only owners or managers can refresh terminal state';
  END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT b.id AS bid
    FROM public.branches b
    WHERE b.restaurant_id = _restaurant_id
      AND (_branch_id IS NULL OR b.id = _branch_id)
  ), bumped AS (
    INSERT INTO public.pos_entity_versions AS pev
      (restaurant_id, entity_type, entity_id, version, updated_at)
    SELECT _restaurant_id, 'menu_prices', t.bid::text, 1, now()
    FROM targets t
    ON CONFLICT (restaurant_id, entity_type, entity_id)
    DO UPDATE SET version = pev.version + 1, updated_at = now()
    RETURNING (pev.entity_id)::uuid AS bid, pev.version
  )
  SELECT bumped.bid, bumped.version FROM bumped;

  INSERT INTO public.audit_logs (restaurant_id, user_id, action, table_name, record_id, new_values)
  VALUES (
    _restaurant_id,
    v_uid,
    'terminal_state_refresh',
    'pos_terminals',
    NULL,
    jsonb_build_object(
      'branch_id', _branch_id,
      'terminal_uid', _terminal_uid,
      'requested_at', now()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_terminal_state_refresh(uuid, uuid, text) TO authenticated;