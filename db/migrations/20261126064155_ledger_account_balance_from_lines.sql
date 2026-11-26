-- Ledger integrity, phase A (docs/plans/ledger-integrity.md):
-- chart_of_accounts.balance is owned by the ledger.
--
-- Before: update_account_balance() ran AFTER INSERT only, so voiding a line (is_voided = true),
-- moving it to another account or deleting it never changed the stored balance, and four posting
-- functions (post_waste_to_ledger, post_weekly_cogs_to_ledger, remap_expenses_to_supplier_ap_head,
-- reclassify_expense_credit_account) also wrote balance by hand on top of the trigger. On the
-- staging copy of production, 25 accounts had drifted by SAR 735,876 in total while the reports,
-- which sum non-voided lines, were right.
--
-- After:
--   * balance = sum(debit - credit) over the account's non-voided lines, kept by one trigger that
--     handles INSERT, DELETE and UPDATE of account_id / debit / credit / is_voided;
--   * any other write to balance (those four functions, imports, the browser) is ignored by a
--     guard trigger on chart_of_accounts; new accounts start at 0;
--   * recompute_account_balances() rebuilds the column from the ledger and records each
--     correction in account_balance_recompute_log. It runs once here and nightly from the
--     ledger-balance-check function.

-- 1. Correction log ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_balance_recompute_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  old_balance   numeric(15,2),
  new_balance   numeric(15,2) NOT NULL,
  source        text NOT NULL,
  recomputed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_balance_recompute_log_tenant
  ON public.account_balance_recompute_log (tenant_id, recomputed_at DESC);

ALTER TABLE public.account_balance_recompute_log ENABLE ROW LEVEL SECURITY;
-- Read-only for members of the tenant; written only by recompute_account_balances().
CREATE POLICY "Tenant members can view balance corrections"
  ON public.account_balance_recompute_log FOR SELECT
  USING (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), tenant_id));
REVOKE ALL ON public.account_balance_recompute_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.account_balance_recompute_log FROM authenticated;

-- 2. Only the ledger may change balance ---------------------------------------------------------
-- The ledger trigger and the recompute set matbex.ledger_balance_sync = 'on' for the duration of
-- their own UPDATE; every other write keeps the old value.
CREATE OR REPLACE FUNCTION public.guard_account_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('matbex.ledger_balance_sync', true) IS DISTINCT FROM 'on' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.balance := 0;
    ELSE
      NEW.balance := OLD.balance;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_account_balance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_account_balance_ins ON public.chart_of_accounts;
CREATE TRIGGER trg_guard_account_balance_ins
  BEFORE INSERT ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_balance();

DROP TRIGGER IF EXISTS trg_guard_account_balance_upd ON public.chart_of_accounts;
CREATE TRIGGER trg_guard_account_balance_upd
  BEFORE UPDATE OF balance ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_balance();

-- 3. Ledger trigger: apply each line's live amount (voided lines count as 0) --------------------
CREATE OR REPLACE FUNCTION public.update_account_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old numeric := 0;
  v_new numeric := 0;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND NOT COALESCE(OLD.is_voided, false) THEN
    v_old := COALESCE(OLD.debit, 0) - COALESCE(OLD.credit, 0);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NOT COALESCE(NEW.is_voided, false) THEN
    v_new := COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0);
  END IF;

  PERFORM set_config('matbex.ledger_balance_sync', 'on', true);

  IF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    IF v_old <> 0 THEN
      UPDATE public.chart_of_accounts
        SET balance = COALESCE(balance, 0) - v_old, updated_at = now()
        WHERE id = OLD.account_id;
    END IF;
    IF v_new <> 0 THEN
      UPDATE public.chart_of_accounts
        SET balance = COALESCE(balance, 0) + v_new, updated_at = now()
        WHERE id = NEW.account_id;
    END IF;
  ELSIF v_new - v_old <> 0 THEN
    UPDATE public.chart_of_accounts
      SET balance = COALESCE(balance, 0) + (v_new - v_old), updated_at = now()
      WHERE id = COALESCE(NEW.account_id, OLD.account_id);
  END IF;

  PERFORM set_config('matbex.ledger_balance_sync', 'off', true);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.update_account_balance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_update_account_balance ON public.account_transactions;
CREATE TRIGGER trigger_update_account_balance
  AFTER INSERT OR DELETE OR UPDATE OF account_id, debit, credit, is_voided ON public.account_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_account_balance();

-- 4. Rebuild from the ledger, logging each correction ------------------------------------------
-- Internal: called by this migration and by the ledger-balance-check server function (service
-- role). Not executable by browsers.
CREATE OR REPLACE FUNCTION public.recompute_account_balances(
  p_tenant_id uuid DEFAULT NULL,
  p_source    text DEFAULT 'manual'
)
RETURNS TABLE (tenant_id uuid, accounts_corrected integer, abs_drift numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('matbex.ledger_balance_sync', 'on', true);

  RETURN QUERY
  WITH live AS (
    SELECT t.account_id,
           SUM(COALESCE(t.debit, 0) - COALESCE(t.credit, 0)) AS amount
      FROM public.account_transactions t
     WHERE NOT COALESCE(t.is_voided, false)
       AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
     GROUP BY t.account_id
  ),
  drift AS (
    SELECT c.id, c.tenant_id, c.balance AS old_balance,
           ROUND(COALESCE(l.amount, 0), 2) AS new_balance
      FROM public.chart_of_accounts c
      LEFT JOIN live l ON l.account_id = c.id
     WHERE (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
       AND COALESCE(c.balance, 0) <> ROUND(COALESCE(l.amount, 0), 2)
  ),
  fixed AS (
    UPDATE public.chart_of_accounts c
       SET balance = d.new_balance, updated_at = now()
      FROM drift d
     WHERE c.id = d.id
    RETURNING c.id
  ),
  logged AS (
    INSERT INTO public.account_balance_recompute_log (tenant_id, account_id, old_balance, new_balance, source)
    SELECT d.tenant_id, d.id, d.old_balance, d.new_balance, p_source
      FROM drift d
      JOIN fixed f ON f.id = d.id
    RETURNING account_balance_recompute_log.tenant_id, old_balance, new_balance
  )
  SELECT g.tenant_id, COUNT(*)::integer, ROUND(SUM(ABS(COALESCE(g.old_balance, 0) - g.new_balance)), 2)
    FROM logged g
   GROUP BY g.tenant_id;

  PERFORM set_config('matbex.ledger_balance_sync', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.recompute_account_balances(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_account_balances(uuid, text) TO service_role;

SELECT * FROM public.recompute_account_balances(NULL, 'migration_20261126_ledger_balance');
