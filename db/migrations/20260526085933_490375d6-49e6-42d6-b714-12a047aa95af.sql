
CREATE OR REPLACE FUNCTION public.grant_tenant_ownership(
  _tenant_id uuid,
  _target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_super boolean := false;
  v_is_owner boolean := false;
  v_is_member boolean := false;
  v_restaurants_updated int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _tenant_id IS NULL OR _target_user_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and target_user_id are required';
  END IF;

  -- Authorization: SuperAdmin OR current tenant owner
  SELECT public.is_superadmin(v_caller) INTO v_is_super;

  IF NOT v_is_super THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_tenant_roles
      WHERE tenant_id = _tenant_id
        AND user_id = v_caller
        AND role = 'owner'::app_role
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'Only SuperAdmins or current tenant owners can transfer ownership';
    END IF;
  END IF;

  -- Target must already be a member of this tenant
  SELECT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE tenant_id = _tenant_id AND user_id = _target_user_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Target user is not a member of this tenant';
  END IF;

  -- Grant owner at tenant level (idempotent)
  INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
  VALUES (_target_user_id, _tenant_id, 'owner'::app_role)
  ON CONFLICT (user_id, tenant_id, role) DO NOTHING;

  -- Grant owner across every restaurant in tenant (idempotent)
  WITH ins AS (
    INSERT INTO public.user_roles (user_id, restaurant_id, role)
    SELECT _target_user_id, r.id, 'owner'::app_role
    FROM public.restaurants r
    WHERE r.tenant_id = _tenant_id
    ON CONFLICT (user_id, restaurant_id, role) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_restaurants_updated FROM ins;

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', _tenant_id,
    'new_owner_id', _target_user_id,
    'restaurants_granted', v_restaurants_updated,
    'granted_by', v_caller,
    'granted_by_superadmin', v_is_super
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_tenant_ownership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_tenant_ownership(uuid, uuid) TO authenticated;
