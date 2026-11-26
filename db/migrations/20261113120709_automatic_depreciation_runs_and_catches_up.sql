-- automatic_depreciation_runs_and_catches_up
--
-- The nightly run_automatic_monthly_depreciation (cron 'auto-monthly-depreciation') failed every
-- night since August 2026 (100 failed runs on the production copy, nothing ever posted):
--   * it posted with no actor (p_actor NULL), and journal_entry_batches.created_by is required;
--   * it read the posted sum as 'amount', but post_monthly_depreciation_internal returns 'total',
--     so a run would record a NULL total_amount (also rejected), and the failure log itself
--     omitted total_amount.
-- It also only ever looked at the previous month, so months it missed were never posted.
-- Found in the CFO review of 2026-11-13.
--
-- Now: the business owner is the recorded actor ("automatic" in the description), every month
-- from the earliest asset's in-service month to last month that has no depreciation yet is posted
-- (one journal per month; the internal function skips assets already done for a month), and
-- failures are logged with total 0.

CREATE OR REPLACE FUNCTION public.run_automatic_monthly_depreciation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_period date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Riyadh')) - interval '1 month')::date;
  v_s record;
  v_res jsonb;
  v_actor uuid;
  v_month date;
  v_first date;
  v_assets integer;
  v_amount numeric(15,2);
  v_tenants integer := 0;
  v_posted integer := 0;
  v_failed integer := 0;
  v_total numeric(15,2) := 0;
BEGIN
  FOR v_s IN
    SELECT s.tenant_id, s.auto_post_day, s.last_auto_posted_month
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
      SELECT user_id INTO v_actor FROM public.user_tenant_roles
      WHERE tenant_id = v_s.tenant_id AND role = 'owner' ORDER BY created_at LIMIT 1;
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'No owner to record as the poster of automatic depreciation';
      END IF;

      SELECT date_trunc('month', min(in_service_date))::date INTO v_first
      FROM public.fixed_assets WHERE tenant_id = v_s.tenant_id AND status = 'active';

      v_month := GREATEST(v_first, COALESCE((v_s.last_auto_posted_month + interval '1 month')::date, v_first));
      WHILE v_month <= v_period LOOP
        v_res := public.post_monthly_depreciation_internal(v_s.tenant_id, v_month, NULL, v_actor);
        v_assets := COALESCE((v_res->>'assets')::int, 0);
        v_amount := COALESCE((v_res->>'total')::numeric, 0);
        IF v_res->>'batch_id' IS NOT NULL THEN
          UPDATE public.journal_entry_batches
          SET description = description || ' (automatic)'
          WHERE id = (v_res->>'batch_id')::uuid;
        END IF;
        INSERT INTO public.fixed_asset_depreciation_runs
          (tenant_id, period_month, run_type, status, assets_count, total_amount, batch_id, triggered_by)
        VALUES
          (v_s.tenant_id, v_month, 'auto', CASE WHEN v_assets > 0 THEN 'success' ELSE 'skipped' END,
           v_assets, v_amount, NULLIF(v_res->>'batch_id','')::uuid, v_actor);
        IF v_assets > 0 THEN
          v_posted := v_posted + 1;
          v_total := v_total + v_amount;
          INSERT INTO public.in_app_notifications
            (user_id, tenant_id, title, message, action_type, entity_type, metadata)
          SELECT ur.user_id, v_s.tenant_id,
                 'Monthly depreciation posted',
                 'Depreciation for ' || to_char(v_month, 'Mon YYYY') || ' posted for ' ||
                 v_assets || ' asset(s), total ' || to_char(v_amount, 'FM999999990.00') || '.',
                 'info', 'fixed_asset_depreciation',
                 jsonb_build_object('period', v_month, 'assets', v_assets, 'amount', v_amount, 'batch_id', v_res->>'batch_id')
          FROM public.user_roles ur
          JOIN public.profiles p ON p.id = ur.user_id
          WHERE p.tenant_id = v_s.tenant_id
            AND ur.role IN ('owner','manager','accountant');
        END IF;
        v_month := (v_month + interval '1 month')::date;
      END LOOP;

      UPDATE public.fixed_asset_settings
      SET last_auto_posted_month = v_period
      WHERE tenant_id = v_s.tenant_id;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.fixed_asset_depreciation_runs
        (tenant_id, period_month, run_type, status, assets_count, total_amount, error_message)
      VALUES (v_s.tenant_id, v_period, 'auto', 'failed', 0, 0, SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('period', v_period, 'tenants_considered', v_tenants,
                            'tenants_posted', v_posted, 'failed', v_failed, 'total_amount', v_total);
END;
$function$;
REVOKE ALL ON FUNCTION public.run_automatic_monthly_depreciation() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_automatic_monthly_depreciation() TO service_role;
