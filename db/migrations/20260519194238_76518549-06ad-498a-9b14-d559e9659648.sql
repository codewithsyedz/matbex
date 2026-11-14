
CREATE OR REPLACE FUNCTION public.log_audit_event_rate_limited(
  _action text,
  _entity_type text,
  _new_data jsonb DEFAULT NULL,
  _cooldown_seconds integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _tenant_id uuid;
  _recent_exists boolean;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Resolve tenant from the caller's membership (first match)
  SELECT tenant_id INTO _tenant_id
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1;

  -- Check for a recent matching audit entry from this user
  SELECT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE user_id = _user_id
      AND action = _action
      AND created_at > now() - make_interval(secs => GREATEST(_cooldown_seconds, 1))
  ) INTO _recent_exists;

  IF _recent_exists THEN
    RETURN false;
  END IF;

  INSERT INTO public.audit_logs (user_id, tenant_id, action, entity_type, new_data)
  VALUES (_user_id, _tenant_id, _action, _entity_type, _new_data);

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_audit_event_rate_limited(text, text, jsonb, integer) TO authenticated;
