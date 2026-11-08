-- Epic D2: /admin/sync-health view.
-- Aggregates edge_function_metrics for POS sync endpoints over the last 24h.
CREATE OR REPLACE VIEW public.sync_health_v1
WITH (security_invoker = true)
AS
SELECT
  m.function_name,
  COUNT(*)::bigint                                                     AS invocations,
  COUNT(*) FILTER (WHERE m.status_code >= 400 OR m.error_message IS NOT NULL)::bigint AS errors,
  COUNT(*) FILTER (WHERE m.cold_start)::bigint                          AS cold_starts,
  percentile_disc(0.5)  WITHIN GROUP (ORDER BY m.duration_ms)::numeric  AS p50_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY m.duration_ms)::numeric  AS p95_ms,
  percentile_disc(0.99) WITHIN GROUP (ORDER BY m.duration_ms)::numeric  AS p99_ms,
  MAX(m.duration_ms)::numeric                                           AS max_ms,
  MAX(m.started_at)                                                     AS last_invocation_at,
  MIN(m.started_at)                                                     AS first_invocation_at
FROM public.edge_function_metrics m
WHERE m.function_name IN ('pos-sync', 'terminal-api')
  AND m.started_at >= now() - interval '24 hours'
GROUP BY m.function_name;

GRANT SELECT ON public.sync_health_v1 TO authenticated;
GRANT SELECT ON public.sync_health_v1 TO service_role;

COMMENT ON VIEW public.sync_health_v1 IS
  'Epic D2: rolling 24h aggregate of POS sync endpoint metrics (pos-sync, terminal-api). Read-only.';