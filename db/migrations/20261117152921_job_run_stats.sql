-- Per-job figures for the SuperAdmin job status page (from public.job_runs, last 14 days).
CREATE OR REPLACE FUNCTION public.admin_job_run_stats()
RETURNS TABLE (
  job text, kind text, last_started_at timestamptz, last_status text, last_http_status int, last_summary text,
  last_duration_ms int, last_success_at timestamptz, last_failure_at timestamptz, last_failure_summary text,
  runs_24h int, failures_24h int
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'SuperAdmin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH last AS (
    SELECT DISTINCT ON (r.job) r.job, r.kind, r.started_at, r.status, r.http_status, r.summary,
           (extract(epoch FROM r.finished_at - r.started_at) * 1000)::int AS ms
      FROM public.job_runs r ORDER BY r.job, r.started_at DESC
  ), ok AS (
    SELECT r.job, max(r.started_at) AS at FROM public.job_runs r WHERE r.status = 'succeeded' GROUP BY r.job
  ), bad AS (
    SELECT DISTINCT ON (r.job) r.job, r.started_at AS at, r.summary FROM public.job_runs r
     WHERE r.status = 'failed' ORDER BY r.job, r.started_at DESC
  ), day AS (
    SELECT r.job, count(*)::int AS runs, count(*) FILTER (WHERE r.status = 'failed')::int AS failures
      FROM public.job_runs r WHERE r.started_at > now() - interval '24 hours' GROUP BY r.job
  )
  SELECT l.job, l.kind, l.started_at, l.status, l.http_status, l.summary, l.ms,
         ok.at, bad.at, bad.summary, COALESCE(day.runs, 0), COALESCE(day.failures, 0)
    FROM last l
    LEFT JOIN ok ON ok.job = l.job
    LEFT JOIN bad ON bad.job = l.job
    LEFT JOIN day ON day.job = l.job;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_job_run_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_job_run_stats() TO authenticated, service_role;
