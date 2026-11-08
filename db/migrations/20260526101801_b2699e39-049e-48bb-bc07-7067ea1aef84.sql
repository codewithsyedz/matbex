
-- 1) Refresh grant_tenant_ownership to also clear lower roles for that user
CREATE OR REPLACE FUNCTION public.grant_tenant_ownership(_tenant_id uuid, _target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Remove any non-owner tenant roles for this user (no more duplicate badges)
  DELETE FROM public.user_tenant_roles
  WHERE tenant_id = _tenant_id
    AND user_id = _target_user_id
    AND role <> 'owner'::app_role;

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

  -- Remove any non-owner restaurant roles for this user on tenant restaurants
  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role <> 'owner'::app_role
    AND restaurant_id IN (SELECT id FROM public.restaurants WHERE tenant_id = _tenant_id);

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', _tenant_id,
    'new_owner_id', _target_user_id,
    'restaurants_granted', v_restaurants_updated,
    'granted_by', v_caller,
    'granted_by_superadmin', v_is_super
  );
END;
$function$;

-- 2) New: revoke_tenant_ownership - demote an owner back to a lower role
CREATE OR REPLACE FUNCTION public.revoke_tenant_ownership(
  _tenant_id uuid,
  _target_user_id uuid,
  _new_role app_role DEFAULT 'manager'::app_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_is_super boolean := false;
  v_is_owner boolean := false;
  v_remaining_owners int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _tenant_id IS NULL OR _target_user_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and target_user_id are required';
  END IF;

  IF _new_role = 'owner'::app_role THEN
    RAISE EXCEPTION 'New role must be manager, cashier, or accountant';
  END IF;

  SELECT public.is_superadmin(v_caller) INTO v_is_super;

  IF NOT v_is_super THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_tenant_roles
      WHERE tenant_id = _tenant_id
        AND user_id = v_caller
        AND role = 'owner'::app_role
    ) INTO v_is_owner;

    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'Only SuperAdmins or tenant owners can revoke ownership';
    END IF;

    IF v_caller = _target_user_id THEN
      RAISE EXCEPTION 'You cannot revoke your own ownership. Ask another owner to do it.';
    END IF;
  END IF;

  -- Ensure at least one other owner will remain
  SELECT count(*) INTO v_remaining_owners
  FROM public.user_tenant_roles
  WHERE tenant_id = _tenant_id
    AND role = 'owner'::app_role
    AND user_id <> _target_user_id;

  IF v_remaining_owners < 1 THEN
    RAISE EXCEPTION 'Cannot revoke ownership: this is the only owner of the tenant';
  END IF;

  -- Drop owner roles
  DELETE FROM public.user_tenant_roles
  WHERE tenant_id = _tenant_id
    AND user_id = _target_user_id
    AND role = 'owner'::app_role;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role = 'owner'::app_role
    AND restaurant_id IN (SELECT id FROM public.restaurants WHERE tenant_id = _tenant_id);

  -- Insert the new tenant-level role
  INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
  VALUES (_target_user_id, _tenant_id, _new_role)
  ON CONFLICT (user_id, tenant_id, role) DO NOTHING;

  -- Insert new restaurant-level role for every restaurant in tenant
  INSERT INTO public.user_roles (user_id, restaurant_id, role)
  SELECT _target_user_id, r.id, _new_role
  FROM public.restaurants r
  WHERE r.tenant_id = _tenant_id
  ON CONFLICT (user_id, restaurant_id, role) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', _tenant_id,
    'user_id', _target_user_id,
    'new_role', _new_role,
    'revoked_by', v_caller,
    'revoked_by_superadmin', v_is_super
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.revoke_tenant_ownership(uuid, uuid, app_role) TO authenticated;
