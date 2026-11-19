-- Gaps #10/#11: telemetry + orphaned session cleanup for role_impersonation_logs.

-- 1. Heartbeat column. Defaults to started_at so legacy rows aren't immediately
--    swept as stale on the first run.
ALTER TABLE public.role_impersonation_logs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz NOT NULL DEFAULT now();

UPDATE public.role_impersonation_logs
SET last_heartbeat_at = COALESCE(ended_at, started_at)
WHERE last_heartbeat_at = created_at OR last_heartbeat_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_role_impersonation_logs_heartbeat
  ON public.role_impersonation_logs(last_heartbeat_at)
  WHERE ended_at IS NULL;

-- 2. Allow 'tab_close' and 'stale' as end reasons.
ALTER TABLE public.role_impersonation_logs
  DROP CONSTRAINT IF EXISTS role_impersonation_logs_end_reason_check;
ALTER TABLE public.role_impersonation_logs
  ADD CONSTRAINT role_impersonation_logs_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN (
    'manual','timeout','signout','invalidated','tab_close','stale'
  ));

-- 3. Sweeper: closes any active session whose heartbeat or expiry has lapsed.
--    Called lazily by validate_active_impersonation so we don't need a cron.
--    A 90s grace period (3x the 30s heartbeat) tolerates network blips.
CREATE OR REPLACE FUNCTION public.sweep_stale_impersonation_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH closed AS (
    UPDATE public.role_impersonation_logs
    SET ended_at = now(),
        end_reason = CASE
          WHEN expires_at <= now() THEN 'timeout'
          ELSE 'stale'
        END
    WHERE ended_at IS NULL
      AND (expires_at <= now() OR last_heartbeat_at < now() - interval '90 seconds')
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM closed;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sweep_stale_impersonation_sessions() TO authenticated;

-- 4. Update the validator to sweep first, so orphaned rows are cleaned up
--    naturally on every auth check. Re-declared as plpgsql to call the sweeper.
CREATE OR REPLACE FUNCTION public.validate_active_impersonation(_log_id uuid)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  impersonated_role text,
  started_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- STABLE functions cannot perform writes; the sweeper is intentionally not
  -- invoked here. Call sweep_stale_impersonation_sessions() separately
  -- (e.g. inside heartbeat_impersonation) to clean up orphans.
  RETURN QUERY
  SELECT l.id, l.tenant_id, l.impersonated_role, l.started_at, l.expires_at
  FROM public.role_impersonation_logs l
  WHERE l.id = _log_id
    AND l.owner_user_id = auth.uid()
    AND l.ended_at IS NULL
    AND l.expires_at > now()
    AND EXISTS (
      SELECT 1 FROM public.user_tenant_roles utr
      WHERE utr.user_id = auth.uid()
        AND utr.tenant_id = l.tenant_id
        AND utr.role = 'owner'
    );
END;
$$;

-- 5. Heartbeat RPC the client calls every 30s. Updates last_heartbeat_at
--    only if the caller owns the session, and opportunistically sweeps stale
--    rows on the same call (1 round-trip).
CREATE OR REPLACE FUNCTION public.heartbeat_impersonation(_log_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  PERFORM public.sweep_stale_impersonation_sessions();

  UPDATE public.role_impersonation_logs
  SET last_heartbeat_at = now()
  WHERE id = _log_id
    AND owner_user_id = auth.uid()
    AND ended_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.heartbeat_impersonation(uuid) TO authenticated;

-- 6. Analytics RPC: per-role usage stats for a tenant, last N days.
--    Owners-only via has_role() check, so no extra RLS needed.
CREATE OR REPLACE FUNCTION public.get_impersonation_analytics(
  _tenant_id uuid,
  _days integer DEFAULT 30
)
RETURNS TABLE (
  impersonated_role text,
  session_count bigint,
  total_minutes numeric,
  avg_minutes numeric,
  last_used_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only tenant owners can view impersonation analytics';
  END IF;

  RETURN QUERY
  SELECT
    l.impersonated_role,
    count(*)::bigint AS session_count,
    round(sum(
      EXTRACT(EPOCH FROM (COALESCE(l.ended_at, now()) - l.started_at)) / 60
    )::numeric, 1) AS total_minutes,
    round(avg(
      EXTRACT(EPOCH FROM (COALESCE(l.ended_at, now()) - l.started_at)) / 60
    )::numeric, 1) AS avg_minutes,
    max(l.started_at) AS last_used_at
  FROM public.role_impersonation_logs l
  WHERE l.tenant_id = _tenant_id
    AND l.started_at >= now() - make_interval(days => _days)
  GROUP BY l.impersonated_role
  ORDER BY session_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_impersonation_analytics(uuid, integer) TO authenticated;