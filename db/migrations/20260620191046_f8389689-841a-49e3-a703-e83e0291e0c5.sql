
CREATE OR REPLACE FUNCTION public.resolve_branch_account(
  _parent_account_id uuid,
  _branch_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_name text;
  v_child_id uuid;
BEGIN
  IF _parent_account_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF _branch_id IS NULL THEN
    RETURN _parent_account_id;
  END IF;

  SELECT name INTO v_branch_name FROM public.branches WHERE id = _branch_id;
  IF v_branch_name IS NULL THEN
    RETURN _parent_account_id;
  END IF;

  -- Prefer an active child account whose name contains the branch name.
  SELECT id INTO v_child_id
  FROM public.chart_of_accounts
  WHERE parent_id = _parent_account_id
    AND is_active = true
    AND account_name ILIKE '%' || v_branch_name || '%'
  ORDER BY account_code
  LIMIT 1;

  RETURN COALESCE(v_child_id, _parent_account_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_branch_account(uuid, uuid) TO authenticated, service_role;
