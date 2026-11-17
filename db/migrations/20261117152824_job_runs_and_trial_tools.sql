-- Scheduled job history for the SuperAdmin job status page, and SuperAdmin trial extensions.
--
-- job_runs: one row per run of a scheduled server function (schedules.ts), a database cron job
-- (cron.job) or a function call queued by a cron job (net.http_post). The scheduler writes it;
-- it keeps 14 days. SuperAdmins (two-factor sessions) can read it; nobody else.

CREATE TABLE IF NOT EXISTS public.job_runs (
  id bigserial PRIMARY KEY,
  job text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('function', 'sql', 'queued')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  http_status int,
  -- the function's reply (its summary) or the error, cut to 1000 characters
  summary text
);
CREATE INDEX IF NOT EXISTS job_runs_job_started_idx ON public.job_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS job_runs_started_idx ON public.job_runs (started_at);

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_runs_superadmin_read" ON public.job_runs;
CREATE POLICY "job_runs_superadmin_read" ON public.job_runs
  FOR SELECT TO authenticated USING (public.is_superadmin(auth.uid()));
GRANT SELECT ON public.job_runs TO authenticated;
GRANT ALL ON public.job_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.job_runs_id_seq TO service_role;

-- Database cron jobs (cron schema is not exposed through the REST API): name, schedule, whether
-- active, and the function it calls (when it is a net.http_post to /functions/v1/<name>).
CREATE OR REPLACE FUNCTION public.admin_cron_jobs()
RETURNS TABLE (jobid bigint, jobname text, schedule text, active boolean, target_function text, command text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
BEGIN
  -- Server functions call this with the service role; signed-in users must be SuperAdmins.
  IF auth.uid() IS NOT NULL AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'SuperAdmin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT j.jobid, j.jobname::text, j.schedule::text, j.active,
           substring(j.command from '/functions/v1/([a-z0-9-]+)'),
           left(regexp_replace(j.command, '\s+', ' ', 'g'), 200)
      FROM cron.job j
     ORDER BY j.jobid;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_cron_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cron_jobs() TO authenticated, service_role;

-- Last database-cron outcomes from cron.job_run_details, for runs from before job_runs existed.
CREATE OR REPLACE FUNCTION public.admin_cron_last_runs()
RETURNS TABLE (jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'SuperAdmin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT DISTINCT ON (d.jobid) d.jobid, d.status::text, left(d.return_message, 300), d.start_time, d.end_time
      FROM cron.job_run_details d
     ORDER BY d.jobid, d.start_time DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_cron_last_runs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cron_last_runs() TO authenticated, service_role;
