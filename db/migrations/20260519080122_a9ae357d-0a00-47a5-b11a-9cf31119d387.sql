CREATE OR REPLACE FUNCTION public.remove_team_member(
  p_user_role_id uuid,
  p_user_id uuid,
  p_restaurant_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_remaining_users int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'You cannot remove yourself' USING ERRCODE = '22023';
  END IF;

  -- Only owners of this tenant can remove members
  IF NOT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = v_caller
      AND tenant_id = p_tenant_id
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only owners can remove team members' USING ERRCODE = '42501';
  END IF;

  -- Verify the target role belongs to the given restaurant + user
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE id = p_user_role_id
      AND user_id = p_user_id
      AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Team member not found in this restaurant' USING ERRCODE = '02000';
  END IF;

  -- Atomic removal
  DELETE FROM public.user_roles
  WHERE id = p_user_role_id;

  DELETE FROM public.user_tenant_roles
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id;

  SELECT user_count INTO v_remaining_users
  FROM public.tenant_usage
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_count', COALESCE(v_remaining_users, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_team_member(uuid, uuid, uuid, uuid) TO authenticated;