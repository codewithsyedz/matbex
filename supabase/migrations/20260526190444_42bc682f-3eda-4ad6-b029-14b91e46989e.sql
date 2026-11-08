
CREATE OR REPLACE FUNCTION public.expire_trials()
RETURNS TABLE(tenant_id uuid, previous_plan uuid, downgraded_to uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free_plan_id uuid;
  v_row RECORD;
  v_has_audit boolean;
BEGIN
  SELECT id INTO v_free_plan_id FROM public.plans WHERE name = 'free' LIMIT 1;
  IF v_free_plan_id IS NULL THEN
    RAISE EXCEPTION 'Free plan not found - cannot expire trials';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='audit_logs'
  ) INTO v_has_audit;

  FOR v_row IN
    SELECT t.id, t.plan_id
    FROM public.tenants t
    WHERE t.status = 'trial'
      AND t.trial_ends_at IS NOT NULL
      AND t.trial_ends_at < now()
      AND (t.plan_id IS DISTINCT FROM v_free_plan_id)
    FOR UPDATE
  LOOP
    UPDATE public.tenants
    SET plan_id = v_free_plan_id,
        status = 'expired',
        updated_at = now()
    WHERE id = v_row.id;

    IF v_has_audit THEN
      BEGIN
        EXECUTE format(
          'INSERT INTO public.audit_logs (tenant_id, action, entity_type, entity_id, metadata) VALUES (%L, %L, %L, %L, %L::jsonb)',
          v_row.id, 'tenant_trial_expired', 'tenant', v_row.id,
          jsonb_build_object('previous_plan_id', v_row.plan_id, 'downgraded_to_plan_id', v_free_plan_id)::text
        );
      EXCEPTION WHEN OTHERS THEN
        -- audit_logs schema may differ; skip silently rather than block downgrade
        NULL;
      END;
    END IF;

    tenant_id := v_row.id;
    previous_plan := v_row.plan_id;
    downgraded_to := v_free_plan_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_trials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_trials() TO service_role;
