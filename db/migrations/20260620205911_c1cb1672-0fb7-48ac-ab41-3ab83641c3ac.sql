CREATE OR REPLACE FUNCTION public.update_branch(
  _branch_id uuid,
  _name text DEFAULT NULL,
  _code text DEFAULT NULL,
  _address text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _restaurant_id uuid DEFAULT NULL
)
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
  v_current_tenant uuid;
  v_target_tenant uuid;
  v_target_is_owner boolean;
  v_target_is_manager boolean;
  v_dup_code int;
  v_child_rows int;
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

  -- Handle restaurant_id (location) change
  IF _restaurant_id IS NOT NULL AND _restaurant_id <> v_branch_record.restaurant_id THEN
    -- Must be same tenant
    SELECT tenant_id INTO v_current_tenant FROM restaurants WHERE id = v_branch_record.restaurant_id;
    SELECT tenant_id INTO v_target_tenant FROM restaurants WHERE id = _restaurant_id;
    IF v_target_tenant IS NULL THEN
      RAISE EXCEPTION 'Target location not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_current_tenant IS DISTINCT FROM v_target_tenant THEN
      RAISE EXCEPTION 'Cannot move branch to a location in a different tenant' USING ERRCODE = 'P0001';
    END IF;

    -- Caller must also be authorized on the target restaurant
    IF NOT v_is_superadmin THEN
      SELECT has_role(v_user_id, _restaurant_id, 'owner') INTO v_target_is_owner;
      SELECT has_role(v_user_id, _restaurant_id, 'manager') INTO v_target_is_manager;
      IF NOT v_target_is_owner AND NOT v_target_is_manager THEN
        RAISE EXCEPTION 'Forbidden - requires owner/manager on target location' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Primary branches cannot be moved (each restaurant needs its own primary)
    IF v_branch_record.is_primary THEN
      RAISE EXCEPTION 'Primary branches cannot be moved to another location' USING ERRCODE = 'P0001';
    END IF;

    -- Check for code collision in target restaurant
    IF v_branch_record.code IS NOT NULL THEN
      SELECT count(*) INTO v_dup_code
      FROM branches
      WHERE restaurant_id = _restaurant_id
        AND lower(code) = lower(v_branch_record.code)
        AND deleted_at IS NULL
        AND id <> _branch_id;
      IF v_dup_code > 0 THEN
        RAISE EXCEPTION 'Short code "%" already exists in the target location', v_branch_record.code USING ERRCODE = '23505';
      END IF;
    END IF;

    -- Block move if branch has operational data tied to it (would create restaurant/branch mismatch)
    SELECT COALESCE((SELECT count(*) FROM sales_transactions WHERE branch_id = _branch_id), 0)
         + COALESCE((SELECT count(*) FROM shifts WHERE branch_id = _branch_id), 0)
         + COALESCE((SELECT count(*) FROM cash_events WHERE branch_id = _branch_id), 0)
         + COALESCE((SELECT count(*) FROM expenses WHERE branch_id = _branch_id), 0)
         + COALESCE((SELECT count(*) FROM inventory_items WHERE branch_id = _branch_id), 0)
         + COALESCE((SELECT count(*) FROM purchases WHERE branch_id = _branch_id), 0)
      INTO v_child_rows;
    IF v_child_rows > 0 THEN
      RAISE EXCEPTION 'Branch has % operational record(s) and cannot be moved. Archive it and create a new branch in the target location instead.', v_child_rows USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY
  UPDATE branches AS b
  SET
    name = COALESCE(_name, b.name),
    code = COALESCE(_code, b.code),
    address = COALESCE(_address, b.address),
    phone = COALESCE(_phone, b.phone),
    restaurant_id = COALESCE(_restaurant_id, b.restaurant_id),
    updated_at = now()
  WHERE b.id = _branch_id
    AND b.deleted_at IS NULL
  RETURNING b.id, b.restaurant_id, b.name, b.code, b.address, b.phone, b.is_primary, b.is_active;
END;
$function$;