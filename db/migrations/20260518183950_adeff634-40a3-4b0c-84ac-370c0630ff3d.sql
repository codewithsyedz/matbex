CREATE OR REPLACE FUNCTION public.update_branch(
  _branch_id uuid,
  _name text DEFAULT NULL,
  _code text DEFAULT NULL,
  _address text DEFAULT NULL,
  _phone text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  restaurant_id uuid,
  name text,
  code text,
  address text,
  phone text,
  is_primary boolean,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_record record;
  v_user_id uuid;
  v_is_superadmin boolean;
  v_is_owner boolean;
  v_is_manager boolean;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  -- Check superadmin
  SELECT is_superadmin(v_user_id) INTO v_is_superadmin;
  
  -- Get branch details
  SELECT * INTO v_branch_record FROM branches WHERE id = _branch_id AND deleted_at IS NULL;
  
  IF v_branch_record IS NULL THEN
    RAISE EXCEPTION 'Branch not found' USING ERRCODE = 'P0002';
  END IF;
  
  -- Check ownership/management
  SELECT has_role(v_user_id, v_branch_record.restaurant_id, 'owner') INTO v_is_owner;
  SELECT has_role(v_user_id, v_branch_record.restaurant_id, 'manager') INTO v_is_manager;
  
  IF NOT v_is_superadmin AND NOT v_is_owner AND NOT v_is_manager THEN
    RAISE EXCEPTION 'Forbidden - requires SuperAdmin or owner/manager' USING ERRCODE = 'P0001';
  END IF;
  
  -- Update branch
  RETURN QUERY
  UPDATE branches
  SET
    name = COALESCE(_name, name),
    code = COALESCE(_code, code),
    address = COALESCE(_address, address),
    phone = COALESCE(_phone, phone),
    updated_at = now()
  WHERE id = _branch_id
    AND deleted_at IS NULL
  RETURNING id, restaurant_id, name, code, address, phone, is_primary, is_active;
END;
$$;