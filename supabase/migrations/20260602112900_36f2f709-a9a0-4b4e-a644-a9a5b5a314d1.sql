-- P0 hardening for role_impersonation_logs (pg_cron already enabled).

-- (a) Authoritative cron sweeper (every minute).
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sweep-stale-impersonation-sessions';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule(
  'sweep-stale-impersonation-sessions',
  '* * * * *',
  $$SELECT public.sweep_stale_impersonation_sessions();$$
);

-- (b) Lock immutable columns on UPDATE.
CREATE OR REPLACE FUNCTION public.lock_role_impersonation_log_immutable_cols()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Trusted contexts (service_role, cron SECURITY DEFINER) have no auth.uid().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id          IS DISTINCT FROM OLD.tenant_id
  OR NEW.owner_user_id      IS DISTINCT FROM OLD.owner_user_id
  OR NEW.impersonated_role  IS DISTINCT FROM OLD.impersonated_role
  OR NEW.started_at         IS DISTINCT FROM OLD.started_at
  OR NEW.expires_at         IS DISTINCT FROM OLD.expires_at
  OR NEW.user_agent         IS DISTINCT FROM OLD.user_agent
  OR NEW.created_at         IS DISTINCT FROM OLD.created_at
  OR NEW.last_heartbeat_at  IS DISTINCT FROM OLD.last_heartbeat_at
  THEN
    RAISE EXCEPTION 'role_impersonation_logs: only ended_at / end_reason may be updated by the row owner'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'role_impersonation_logs: session already closed, row is immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_role_impersonation_log_cols ON public.role_impersonation_logs;
CREATE TRIGGER trg_lock_role_impersonation_log_cols
BEFORE UPDATE ON public.role_impersonation_logs
FOR EACH ROW
EXECUTE FUNCTION public.lock_role_impersonation_log_immutable_cols();

-- (c) Force server-side timestamps on INSERT.
CREATE OR REPLACE FUNCTION public.enforce_role_impersonation_log_insert_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.started_at        := now();
  NEW.last_heartbeat_at := now();
  NEW.expires_at        := now() + interval '60 minutes';
  NEW.ended_at          := NULL;
  NEW.end_reason        := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_role_impersonation_log_insert ON public.role_impersonation_logs;
CREATE TRIGGER trg_enforce_role_impersonation_log_insert
BEFORE INSERT ON public.role_impersonation_logs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_role_impersonation_log_insert_defaults();