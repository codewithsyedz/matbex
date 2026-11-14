CREATE OR REPLACE FUNCTION public.user_can_access_branch(_user_id uuid, _restaurant_id uuid, _branch_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pinned uuid;
  _has_staff_row boolean;
BEGIN
  IF _user_id IS NULL OR _restaurant_id IS NULL THEN
    RETURN true; -- service role / system contexts
  END IF;

  -- Owners, managers and accountants always have full (all-branch) access
  IF public.has_role(_user_id, _restaurant_id, 'owner'::app_role)
     OR public.has_role(_user_id, _restaurant_id, 'manager'::app_role)
     OR public.has_role(_user_id, _restaurant_id, 'accountant'::app_role) THEN
    RETURN true;
  END IF;

  SELECT s.assigned_branch_id,
         true
    INTO _pinned, _has_staff_row
  FROM public.staff s
  WHERE s.user_id = _user_id
    AND s.restaurant_id = _restaurant_id
    AND s.is_active = true
  ORDER BY (s.assigned_branch_id IS NOT NULL) DESC
  LIMIT 1;

  IF _pinned IS NULL THEN
    RETURN true;
  END IF;

  RETURN _branch_id IS NULL OR _branch_id = _pinned;
END;
$function$;