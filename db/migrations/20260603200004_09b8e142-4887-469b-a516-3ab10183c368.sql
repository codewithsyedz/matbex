-- ============================================================================
-- #12 Feature-flag audit trail
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_feature_flag_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_entity_id uuid;
  v_new jsonb;
  v_old jsonb;
BEGIN
  v_new := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  v_old := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;

  v_tenant_id := COALESCE(
    NULLIF(v_new->>'tenant_id', '')::uuid,
    NULLIF(v_old->>'tenant_id', '')::uuid
  );
  v_entity_id := COALESCE(
    NULLIF(v_new->>'id', '')::uuid,
    NULLIF(v_old->>'id', '')::uuid
  );

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, entity_type, entity_id, old_data, new_data
  ) VALUES (
    auth.uid(),
    v_tenant_id,
    'feature_flag_' || lower(TG_OP),
    TG_TABLE_NAME,
    v_entity_id,
    v_old,
    v_new
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_plans_feature_flag ON public.plans;
CREATE TRIGGER trg_audit_plans_feature_flag
AFTER INSERT OR UPDATE OR DELETE ON public.plans
FOR EACH ROW EXECUTE FUNCTION public.log_feature_flag_change();

DROP TRIGGER IF EXISTS trg_audit_tenant_features_feature_flag ON public.tenant_features;
CREATE TRIGGER trg_audit_tenant_features_feature_flag
AFTER INSERT OR UPDATE OR DELETE ON public.tenant_features
FOR EACH ROW EXECUTE FUNCTION public.log_feature_flag_change();

DROP TRIGGER IF EXISTS trg_audit_tenant_addons_feature_flag ON public.tenant_addons;
CREATE TRIGGER trg_audit_tenant_addons_feature_flag
AFTER INSERT OR UPDATE OR DELETE ON public.tenant_addons
FOR EACH ROW EXECUTE FUNCTION public.log_feature_flag_change();

-- ============================================================================
-- #13 Edge function health metrics
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.edge_function_metrics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name   text NOT NULL,
  request_id      text,
  tenant_id       uuid,
  status_code     integer,
  duration_ms     integer NOT NULL,
  cold_start      boolean NOT NULL DEFAULT false,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.edge_function_metrics TO authenticated;
GRANT ALL    ON public.edge_function_metrics TO service_role;

ALTER TABLE public.edge_function_metrics ENABLE ROW LEVEL SECURITY;

-- SuperAdmins can read; nobody else.
CREATE POLICY "SuperAdmins read edge_function_metrics"
ON public.edge_function_metrics
FOR SELECT
TO authenticated
USING (public.is_superadmin(auth.uid()));

-- Inserts are server-side only (service_role bypasses RLS).
CREATE POLICY "No client inserts to edge_function_metrics"
ON public.edge_function_metrics
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_efm_function_started
  ON public.edge_function_metrics (function_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_efm_started
  ON public.edge_function_metrics (started_at DESC);

-- Retention: keep 14 days. Manual purge function callable from a scheduled job.
CREATE OR REPLACE FUNCTION public.purge_edge_function_metrics()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.edge_function_metrics
  WHERE started_at < now() - interval '14 days';
$$;

-- 24h rollup view consumed by AdminEdgeFunctionHealth.
CREATE OR REPLACE VIEW public.edge_function_health_24h AS
SELECT
  function_name,
  count(*)                                                                  AS invocations,
  count(*) FILTER (WHERE status_code >= 500 OR error_message IS NOT NULL)   AS errors,
  count(*) FILTER (WHERE cold_start)                                        AS cold_starts,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms)                 AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)                 AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)                 AS p99_ms,
  max(duration_ms)                                                          AS max_ms,
  max(started_at)                                                           AS last_invocation_at
FROM public.edge_function_metrics
WHERE started_at >= now() - interval '24 hours'
GROUP BY function_name;

GRANT SELECT ON public.edge_function_health_24h TO authenticated;
GRANT SELECT ON public.edge_function_health_24h TO service_role;