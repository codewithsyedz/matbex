-- seed_standard_coa_for_new_tenants
--
-- The standard chart of accounts (ensure_standard_coa_accounts: cash, bank, receivables,
-- payables, VAT, revenue, operating expenses, ...) was only ever applied once, as a
-- backfill in 20260130133953 for the tenants that existed then. No tenant created since
-- (approve-application, complete-registration-payment, start-free-trial) gets it: they
-- only receive the 12 ingredient inventory/COGS accounts from trg_seed_ingredient_setup.
-- Such tenants have no cash or bank account to pay an expense from, no revenue or VAT
-- accounts for posting, etc.
--
-- ensure_standard_coa_accounts upserts with DO UPDATE on account_name/description, and
-- some of its codes clash with the ingredient setup (e.g. 1210 "Inventory - Beverages"
-- vs 1210 "Meat Inventory"). Calling it directly would rename accounts tenants already
-- use. seed_standard_coa_missing() keeps the canonical list in one place but only adds
-- what is missing: it snapshots the tenant's accounts, runs the standard seeder, and
-- restores the snapshotted name/description/system flag for codes that already existed.

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

  SELECT count(*) INTO v_after FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id;
  RETURN v_after - v_before;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_standard_coa_missing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_standard_coa_missing(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_seed_standard_coa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_standard_coa_missing(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_seed_standard_coa() FROM PUBLIC, anon, authenticated;

-- AFTER INSERT triggers fire in name order: this runs after trg_seed_ingredient_setup,
-- so the ingredient accounts exist first and keep their names.
DROP TRIGGER IF EXISTS trg_seed_standard_coa ON public.tenants;
CREATE TRIGGER trg_seed_standard_coa
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_standard_coa();

-- Backfill tenants created since the one-off 20260130 backfill (no Cash on Hand account).
DO $$
DECLARE
  t record;
  n integer := 0;
BEGIN
  FOR t IN
    SELECT id FROM public.tenants tn
    WHERE NOT EXISTS (
      SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = tn.id AND c.account_code = '1000'
    )
  LOOP
    PERFORM public.seed_standard_coa_missing(t.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'seed_standard_coa_for_new_tenants: backfilled % tenant(s)', n;
END $$;
