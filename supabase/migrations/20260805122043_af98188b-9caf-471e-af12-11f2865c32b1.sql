-- Automation settings
ALTER TABLE public.fixed_asset_settings
  ADD COLUMN IF NOT EXISTS auto_post_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_post_day integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_auto_posted_month date;

ALTER TABLE public.fixed_asset_settings
  DROP CONSTRAINT IF EXISTS fixed_asset_settings_auto_day_chk;
ALTER TABLE public.fixed_asset_settings
  ADD CONSTRAINT fixed_asset_settings_auto_day_chk CHECK (auto_post_day BETWEEN 1 AND 28);

-- Run log
CREATE TABLE IF NOT EXISTS public.fixed_asset_depreciation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  run_type text NOT NULL DEFAULT 'auto',
  status text NOT NULL DEFAULT 'success',
  assets_count integer NOT NULL DEFAULT 0,
  total_amount numeric(15,2) NOT NULL DEFAULT 0,
  batch_id uuid,
  branch_id uuid REFERENCES public.branches(id),
  error_message text,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fad_runs_type_chk CHECK (run_type IN ('auto','manual')),
  CONSTRAINT fad_runs_status_chk CHECK (status IN ('success','skipped','failed'))
);

CREATE INDEX IF NOT EXISTS idx_fad_runs_tenant ON public.fixed_asset_depreciation_runs(tenant_id, period_month DESC);

GRANT SELECT ON public.fixed_asset_depreciation_runs TO authenticated;
GRANT ALL ON public.fixed_asset_depreciation_runs TO service_role;
ALTER TABLE public.fixed_asset_depreciation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance roles can view depreciation runs" ON public.fixed_asset_depreciation_runs;
CREATE POLICY "Finance roles can view depreciation runs"
  ON public.fixed_asset_depreciation_runs FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.can_manage_capital(tenant_id));

-- Core engine (no auth check; callers must authorize)
CREATE OR REPLACE FUNCTION public.post_monthly_depreciation_internal(
  p_tenant_id uuid,
  p_period_month date,
  p_branch_id uuid DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period date := date_trunc('month', p_period_month)::date;
  v_period_end date := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  v_a record;
  v_batch uuid;
  v_monthly numeric(15,2);
  v_remaining numeric(15,2);
  v_total numeric(15,2) := 0;
  v_count integer := 0;
BEGIN
  FOR v_a IN
    SELECT * FROM public.fixed_assets
    WHERE tenant_id = p_tenant_id
      AND status = 'active'
      AND in_service_date <= v_period_end
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.fixed_asset_depreciation d
        WHERE d.asset_id = fixed_assets.id AND d.period_month = v_period
      )
    ORDER BY acquisition_date
  LOOP
    v_monthly := ROUND((v_a.cost - v_a.salvage_value) / GREATEST(v_a.useful_life_months, 1), 2);
    v_remaining := ROUND(v_a.cost - v_a.salvage_value - v_a.accumulated_depreciation, 2);
    IF v_remaining <= 0 THEN
      UPDATE public.fixed_assets SET status = 'fully_depreciated' WHERE id = v_a.id;
      CONTINUE;
    END IF;
    IF v_monthly > v_remaining THEN v_monthly := v_remaining; END IF;
    IF v_monthly <= 0 THEN CONTINUE; END IF;

    IF v_batch IS NULL THEN
      INSERT INTO public.journal_entry_batches
        (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
         created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
      VALUES
        (p_tenant_id, v_period_end, 'Monthly depreciation - ' || to_char(v_period, 'Mon YYYY'),
         'DEP-' || to_char(v_period, 'YYYYMM'), 'adjustment', 'adjustment', p_actor, true, now(), p_actor,
         'approved', p_actor, now(), p_branch_id)
      RETURNING id INTO v_batch;
    END IF;

    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (p_tenant_id, v_a.dep_expense_account_id, v_period_end, v_monthly, 0,
       'Depreciation - ' || v_a.name, 'fixed_asset', v_a.id, p_actor, v_batch, v_a.branch_id),
      (p_tenant_id, v_a.accum_dep_account_id, v_period_end, 0, v_monthly,
       'Depreciation - ' || v_a.name, 'fixed_asset', v_a.id, p_actor, v_batch, v_a.branch_id);

    INSERT INTO public.fixed_asset_depreciation
      (tenant_id, asset_id, branch_id, period_month, amount, batch_id, created_by)
    VALUES (p_tenant_id, v_a.id, v_a.branch_id, v_period, v_monthly, v_batch, p_actor);

    UPDATE public.fixed_assets
    SET accumulated_depreciation = ROUND(accumulated_depreciation + v_monthly, 2),
        status = CASE WHEN ROUND(cost - salvage_value - accumulated_depreciation - v_monthly, 2) <= 0
                      THEN 'fully_depreciated' ELSE status END
    WHERE id = v_a.id;

    v_total := v_total + v_monthly;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('period', v_period, 'assets', v_count, 'amount', v_total, 'batch_id', v_batch);
END;
$$;

REVOKE ALL ON FUNCTION public.post_monthly_depreciation_internal(uuid, date, uuid, uuid) FROM public, anon, authenticated;

-- Manual entry point keeps its signature, now logs the run
CREATE OR REPLACE FUNCTION public.post_monthly_depreciation(
  p_tenant_id uuid,
  p_period_month date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT public.can_manage_capital(p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can post depreciation';
  END IF;

  v_res := public.post_monthly_depreciation_internal(p_tenant_id, p_period_month, p_branch_id, auth.uid());

  INSERT INTO public.fixed_asset_depreciation_runs
    (tenant_id, period_month, run_type, status, assets_count, total_amount, batch_id, branch_id, triggered_by)
  VALUES
    (p_tenant_id, date_trunc('month', p_period_month)::date, 'manual',
     CASE WHEN (v_res->>'assets')::int > 0 THEN 'success' ELSE 'skipped' END,
     (v_res->>'assets')::int, (v_res->>'amount')::numeric,
     NULLIF(v_res->>'batch_id','')::uuid, p_branch_id, auth.uid());

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_monthly_depreciation(uuid, date, uuid) TO authenticated;

-- Scheduler: posts the previous month for every tenant with automation on
CREATE OR REPLACE FUNCTION public.run_automatic_monthly_depreciation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_period date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Riyadh')) - interval '1 month')::date;
  v_s record;
  v_res jsonb;
  v_tenants integer := 0;
  v_posted integer := 0;
  v_failed integer := 0;
  v_total numeric(15,2) := 0;
BEGIN
  FOR v_s IN
    SELECT s.tenant_id, s.auto_post_day
    FROM public.fixed_asset_settings s
    WHERE s.auto_post_enabled
      AND EXTRACT(DAY FROM v_today)::int >= s.auto_post_day
      AND (s.last_auto_posted_month IS NULL OR s.last_auto_posted_month < v_period)
      AND EXISTS (
        SELECT 1 FROM public.fixed_assets a
        WHERE a.tenant_id = s.tenant_id AND a.status = 'active'
      )
  LOOP
    v_tenants := v_tenants + 1;
    BEGIN
      v_res := public.post_monthly_depreciation_internal(v_s.tenant_id, v_period, NULL, NULL);

      INSERT INTO public.fixed_asset_depreciation_runs
        (tenant_id, period_month, run_type, status, assets_count, total_amount, batch_id)
      VALUES
        (v_s.tenant_id, v_period, 'auto',
         CASE WHEN (v_res->>'assets')::int > 0 THEN 'success' ELSE 'skipped' END,
         (v_res->>'assets')::int, (v_res->>'amount')::numeric,
         NULLIF(v_res->>'batch_id','')::uuid);

      UPDATE public.fixed_asset_settings
      SET last_auto_posted_month = v_period
      WHERE tenant_id = v_s.tenant_id;

      IF (v_res->>'assets')::int > 0 THEN
        v_posted := v_posted + 1;
        v_total := v_total + (v_res->>'amount')::numeric;

        INSERT INTO public.in_app_notifications
          (user_id, tenant_id, title, message, action_type, entity_type, metadata)
        SELECT ur.user_id, v_s.tenant_id,
               'Monthly depreciation posted',
               'Depreciation for ' || to_char(v_period, 'Mon YYYY') || ' posted for ' ||
               (v_res->>'assets') || ' asset(s), total ' || to_char((v_res->>'amount')::numeric, 'FM999999990.00') || '.',
               'info', 'fixed_asset_depreciation',
               jsonb_build_object('period', v_period, 'assets', (v_res->>'assets')::int,
                                  'amount', (v_res->>'amount')::numeric, 'batch_id', v_res->>'batch_id')
        FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
        WHERE p.tenant_id = v_s.tenant_id
          AND ur.role IN ('owner','manager','accountant');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.fixed_asset_depreciation_runs
        (tenant_id, period_month, run_type, status, error_message)
      VALUES (v_s.tenant_id, v_period, 'auto', 'failed', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('period', v_period, 'tenants_considered', v_tenants,
                            'tenants_posted', v_posted, 'failed', v_failed, 'total_amount', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.run_automatic_monthly_depreciation() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_automatic_monthly_depreciation() TO service_role;