
CREATE TABLE IF NOT EXISTS public.audit_throttle_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid,
  action text NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  attempt_count integer NOT NULL DEFAULT 1,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, action, day)
);

CREATE INDEX IF NOT EXISTS idx_audit_throttle_counters_tenant_day
  ON public.audit_throttle_counters (tenant_id, day DESC);

ALTER TABLE public.audit_throttle_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own throttle counters"
ON public.audit_throttle_counters
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Owners and managers can view tenant throttle counters"
ON public.audit_throttle_counters
FOR SELECT
TO authenticated
USING (
  tenant_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.restaurants r ON r.id = ur.restaurant_id
    WHERE ur.user_id = auth.uid()
      AND r.tenant_id = audit_throttle_counters.tenant_id
      AND ur.role IN ('owner', 'manager')
  )
);

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

  SELECT r.tenant_id INTO _tenant_id
  FROM public.user_roles ur
  JOIN public.restaurants r ON r.id = ur.restaurant_id
  WHERE ur.user_id = _user_id
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE user_id = _user_id
      AND action = _action
      AND created_at > now() - make_interval(secs => GREATEST(_cooldown_seconds, 1))
  ) INTO _recent_exists;

  IF _recent_exists THEN
    INSERT INTO public.audit_throttle_counters (user_id, tenant_id, action, day, attempt_count, last_attempt_at)
    VALUES (_user_id, _tenant_id, _action, (now() AT TIME ZONE 'utc')::date, 1, now())
    ON CONFLICT (user_id, action, day) DO UPDATE
      SET attempt_count = audit_throttle_counters.attempt_count + 1,
          last_attempt_at = now(),
          tenant_id = COALESCE(audit_throttle_counters.tenant_id, EXCLUDED.tenant_id);
    RETURN false;
  END IF;

  INSERT INTO public.audit_logs (user_id, tenant_id, action, entity_type, new_data)
  VALUES (_user_id, _tenant_id, _action, _entity_type, _new_data);

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_audit_event_rate_limited(text, text, jsonb, integer) TO authenticated;
