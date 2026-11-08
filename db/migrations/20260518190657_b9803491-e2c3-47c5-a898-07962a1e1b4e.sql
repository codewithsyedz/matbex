CREATE OR REPLACE FUNCTION public.update_branch(_branch_id uuid, _name text DEFAULT NULL::text, _code text DEFAULT NULL::text, _address text DEFAULT NULL::text, _phone text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, restaurant_id uuid, name text, code text, address text, phone text, is_primary boolean, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_record record;
  v_user_id uuid;
  v_is_superadmin boolean;
  v_is_owner boolean;
  v_is_manager boolean;
BEGIN
  v_user_id := auth.uid();

  SELECT is_superadmin(v_user_id) INTO v_is_superadmin;

  SELECT * INTO v_branch_record FROM branches b WHERE b.id = _branch_id AND b.deleted_at IS NULL;

  IF v_branch_record IS NULL THEN
    RAISE EXCEPTION 'Branch not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT has_role(v_user_id, v_branch_record.restaurant_id, 'owner') INTO v_is_owner;
  SELECT has_role(v_user_id, v_branch_record.restaurant_id, 'manager') INTO v_is_manager;

  IF NOT v_is_superadmin AND NOT v_is_owner AND NOT v_is_manager THEN
    RAISE EXCEPTION 'Forbidden - requires SuperAdmin or owner/manager' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  UPDATE branches AS b
  SET
    name = COALESCE(_name, b.name),
    code = COALESCE(_code, b.code),
    address = COALESCE(_address, b.address),
    phone = COALESCE(_phone, b.phone),
    updated_at = now()
  WHERE b.id = _branch_id
    AND b.deleted_at IS NULL
  RETURNING b.id, b.restaurant_id, b.name, b.code, b.address, b.phone, b.is_primary, b.is_active;
END;
$function$;