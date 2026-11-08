
CREATE TABLE IF NOT EXISTS public.daily_reconciliation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  branch_id uuid,
  business_date date NOT NULL,
  pos_total numeric NOT NULL DEFAULT 0,
  pos_txn_count integer NOT NULL DEFAULT 0,
  cashier_total numeric NOT NULL DEFAULT 0,
  cashier_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ledger_revenue numeric NOT NULL DEFAULT 0,
  ledger_vat numeric NOT NULL DEFAULT 0,
  variance_pos_vs_cashier numeric NOT NULL DEFAULT 0,
  variance_cashier_vs_ledger numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'balanced',
  tolerance numeric NOT NULL DEFAULT 1,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_recon_unique_day_branch
  ON public.daily_reconciliation_reports (restaurant_id, business_date, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS daily_recon_tenant_date_idx
  ON public.daily_reconciliation_reports (tenant_id, business_date DESC);
CREATE INDEX IF NOT EXISTS daily_recon_status_idx
  ON public.daily_reconciliation_reports (restaurant_id, status);

GRANT SELECT ON public.daily_reconciliation_reports TO authenticated;
GRANT ALL ON public.daily_reconciliation_reports TO service_role;

ALTER TABLE public.daily_reconciliation_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recon_select_tenant" ON public.daily_reconciliation_reports;
CREATE POLICY "recon_select_tenant"
ON public.daily_reconciliation_reports
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'accountant'::app_role)
  )
);

CREATE OR REPLACE FUNCTION public.touch_daily_reconciliation_reports()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_daily_recon ON public.daily_reconciliation_reports;
CREATE TRIGGER trg_touch_daily_recon
BEFORE UPDATE ON public.daily_reconciliation_reports
FOR EACH ROW EXECUTE FUNCTION public.touch_daily_reconciliation_reports();

-- ---------------------------------------------------------------
-- Build the reconciliation rows for one restaurant / one day.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation(
  p_restaurant_id uuid,
  p_date date,
  p_tolerance numeric DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_rows integer := 0;
BEGIN
  SELECT tenant_id, COALESCE(timezone, 'Asia/Riyadh')
    INTO v_tenant, v_tz
  FROM public.restaurants WHERE id = p_restaurant_id;

  IF v_tenant IS NULL THEN RETURN 0; END IF;

  v_start := (p_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_end   := ((p_date + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  WITH pos AS (
    SELECT st.branch_id,
           COALESCE(SUM(st.total), 0)::numeric AS total,
           COUNT(*)::int AS txns
    FROM public.sales_transactions st
    WHERE st.restaurant_id = p_restaurant_id
      AND st.created_at >= v_start AND st.created_at < v_end
    GROUP BY st.branch_id
  ),
  cashier_day AS (
    SELECT d.branch_id, COALESCE(SUM(d.total_sales), 0)::numeric AS total
    FROM public.daily_sales_summary d
    WHERE d.restaurant_id = p_restaurant_id AND d.sales_date = p_date
    GROUP BY d.branch_id
  ),
  cashier_night AS (
    SELECT s.branch_id, COALESCE(SUM(n.total_sales), 0)::numeric AS total
    FROM public.night_shift_summaries n
    LEFT JOIN public.shifts s ON s.id = n.shift_id
    WHERE n.restaurant_id = p_restaurant_id AND n.business_date = p_date
    GROUP BY s.branch_id
  ),
  ledger AS (
    SELECT at.branch_id,
           COALESCE(SUM(CASE WHEN coa.account_type = 'revenue'
                             THEN COALESCE(at.credit,0) - COALESCE(at.debit,0) END), 0)::numeric AS revenue,
           COALESCE(SUM(CASE WHEN coa.account_code = '2200'
                             THEN COALESCE(at.credit,0) - COALESCE(at.debit,0) END), 0)::numeric AS vat
    FROM public.account_transactions at
    JOIN public.chart_of_accounts coa ON coa.id = at.account_id
    WHERE at.tenant_id = v_tenant
      AND at.transaction_date = p_date
      AND COALESCE(at.is_voided, false) = false
      AND (coa.account_type = 'revenue' OR coa.account_code = '2200')
    GROUP BY at.branch_id
  ),
  keys AS (
    SELECT branch_id FROM pos
    UNION SELECT branch_id FROM cashier_day
    UNION SELECT branch_id FROM cashier_night
    UNION SELECT branch_id FROM ledger
  ),
  merged AS (
    SELECT k.branch_id,
           COALESCE(p.total, 0) AS pos_total,
           COALESCE(p.txns, 0) AS pos_txns,
           COALESCE(cd.total, 0) AS cashier_day_total,
           COALESCE(cn.total, 0) AS cashier_night_total,
           COALESCE(cd.total, 0) + COALESCE(cn.total, 0) AS cashier_total,
           COALESCE(l.revenue, 0) AS ledger_revenue,
           COALESCE(l.vat, 0) AS ledger_vat
    FROM keys k
    LEFT JOIN pos p ON p.branch_id IS NOT DISTINCT FROM k.branch_id
    LEFT JOIN cashier_day cd ON cd.branch_id IS NOT DISTINCT FROM k.branch_id
    LEFT JOIN cashier_night cn ON cn.branch_id IS NOT DISTINCT FROM k.branch_id
    LEFT JOIN ledger l ON l.branch_id IS NOT DISTINCT FROM k.branch_id
  )
  INSERT INTO public.daily_reconciliation_reports AS r (
    tenant_id, restaurant_id, branch_id, business_date,
    pos_total, pos_txn_count, cashier_total, cashier_sources,
    ledger_revenue, ledger_vat,
    variance_pos_vs_cashier, variance_cashier_vs_ledger,
    status, tolerance, details, generated_at
  )
  SELECT
    v_tenant, p_restaurant_id, m.branch_id, p_date,
    m.pos_total, m.pos_txns, m.cashier_total,
    jsonb_build_object('daily_sales_summary', m.cashier_day_total, 'night_shift_summaries', m.cashier_night_total),
    m.ledger_revenue, m.ledger_vat,
    ROUND(m.pos_total - m.cashier_total, 2),
    ROUND(m.cashier_total - (m.ledger_revenue + m.ledger_vat), 2),
    CASE
      WHEN m.pos_total = 0 AND m.cashier_total = 0 AND m.ledger_revenue = 0 THEN 'no_activity'
      WHEN m.pos_total = 0 AND m.cashier_total > 0 THEN 'missing_pos'
      WHEN m.cashier_total = 0 AND m.pos_total > 0 THEN 'missing_cashier'
      WHEN (m.ledger_revenue + m.ledger_vat) = 0 AND (m.pos_total > 0 OR m.cashier_total > 0) THEN 'missing_ledger'
      WHEN ABS(m.pos_total - m.cashier_total) > p_tolerance
        OR ABS(m.cashier_total - (m.ledger_revenue + m.ledger_vat)) > p_tolerance THEN 'divergent'
      ELSE 'balanced'
    END,
    p_tolerance,
    jsonb_build_object(
      'ledger_gross', m.ledger_revenue + m.ledger_vat,
      'window_start', v_start,
      'window_end', v_end,
      'timezone', v_tz
    ),
    now()
  FROM merged m
  ON CONFLICT (restaurant_id, business_date, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    pos_total = EXCLUDED.pos_total,
    pos_txn_count = EXCLUDED.pos_txn_count,
    cashier_total = EXCLUDED.cashier_total,
    cashier_sources = EXCLUDED.cashier_sources,
    ledger_revenue = EXCLUDED.ledger_revenue,
    ledger_vat = EXCLUDED.ledger_vat,
    variance_pos_vs_cashier = EXCLUDED.variance_pos_vs_cashier,
    variance_cashier_vs_ledger = EXCLUDED.variance_cashier_vs_ledger,
    status = EXCLUDED.status,
    tolerance = EXCLUDED.tolerance,
    details = EXCLUDED.details,
    generated_at = EXCLUDED.generated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- Re-run a range on demand (used by the UI "Re-run" action).
CREATE OR REPLACE FUNCTION public.rerun_daily_reconciliation_range(
  p_restaurant_id uuid,
  p_from date,
  p_to date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d date; total integer := 0;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), p_restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), p_restaurant_id, 'manager'::app_role)
    OR public.has_role(auth.uid(), p_restaurant_id, 'accountant'::app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorised to run reconciliation for this restaurant';
  END IF;

  IF p_to - p_from > 92 THEN
    RAISE EXCEPTION 'Range too large — reconcile at most 92 days at a time';
  END IF;

  d := p_from;
  WHILE d <= p_to LOOP
    total := total + public.run_daily_reconciliation(p_restaurant_id, d);
    d := d + 1;
  END LOOP;
  RETURN total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rerun_daily_reconciliation_range(uuid, date, date) TO authenticated;

-- Nightly sweep across all restaurants.
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation_all(p_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; total integer := 0; d date;
BEGIN
  FOR r IN SELECT id, COALESCE(timezone, 'Asia/Riyadh') AS tz FROM public.restaurants LOOP
    d := COALESCE(p_date, ((now() AT TIME ZONE r.tz)::date - 1));
    total := total + public.run_daily_reconciliation(r.id, d);
  END LOOP;
  RETURN total;
END;
$$;

DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'daily-pos-ledger-reconciliation';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule(
  'daily-pos-ledger-reconciliation',
  '30 22 * * *',
  $$SELECT public.run_daily_reconciliation_all();$$
);
