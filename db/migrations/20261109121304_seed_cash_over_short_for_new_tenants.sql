-- seed_cash_over_short_for_new_tenants
--
-- Day-end adjustments post against 6999 "Cash Over/Short". That account was created once,
-- by 20260506231755, for the tenants that existed then; nothing creates it for newer
-- tenants, so post_day_end_adjustment_to_ledger fails for them with
-- "Cash Over/Short (6999) not configured". Add it to the per-tenant seeding
-- (seed_standard_coa_missing, run by trg_seed_standard_coa on tenant insert) and backfill
-- tenants that lack it. Same row as the original backfill; existing accounts are untouched.

CREATE OR REPLACE FUNCTION public.seed_standard_coa_missing(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _coa_snapshot (
    account_code text PRIMARY KEY,
    account_name text,
    description text,
    is_system_account boolean
  ) ON COMMIT DROP;
  DELETE FROM _coa_snapshot;

  INSERT INTO _coa_snapshot
  SELECT account_code, account_name, description, is_system_account
  FROM public.chart_of_accounts
  WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_before = ROW_COUNT;

  PERFORM public.ensure_standard_coa_accounts(p_tenant_id);

  UPDATE public.chart_of_accounts c
     SET account_name = s.account_name,
         description = s.description,
         is_system_account = s.is_system_account
    FROM _coa_snapshot s
   WHERE c.tenant_id = p_tenant_id
     AND c.account_code = s.account_code
     AND (c.account_name, c.description, c.is_system_account)
         IS DISTINCT FROM (s.account_name, s.description, s.is_system_account);

  -- Day-end adjustments (see 20260506231755).
  INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, is_active, description)
  VALUES (p_tenant_id, '6999', 'Cash Over/Short', 'expense', true,
          'Auto-created for day-end adjustments and reconciliations')
  ON CONFLICT (tenant_id, account_code) DO NOTHING;

  SELECT count(*) INTO v_after FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id;
  RETURN v_after - v_before;
END;
$$;

INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, is_active, description)
SELECT t.id, '6999', 'Cash Over/Short', 'expense', true,
       'Auto-created for day-end adjustments and reconciliations'
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts c
  WHERE c.tenant_id = t.id AND c.account_code = '6999'
);
