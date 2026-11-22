-- Split tender (phase 1 of docs/plans/split-payments.md): one sale paid by several
-- methods, e.g. 60 SAR cash + 40 SAR card on one receipt and one ZATCA invoice.
--
-- sale_payments lists the tenders of every sale. A sale with one tender keeps its
-- method in sales_transactions.payment_method; a sale with several stores 'split'.
--
-- * Single-tender sales: the database keeps their one tender row in step with the
--   sale (sync_single_sale_tender), so every writer that records or edits a cash /
--   card / other sale (back-office summaries, voids, edits, delivery and online
--   orders, imports) keeps sale_payments right without knowing about it.
-- * Split sales: only POST /api/v1/pos/sales (and the void mirror) write their
--   tenders, inside the sale's transaction.
-- * At commit, every sale's tenders must add up to its total
--   (check_sale_tenders, deferred constraint trigger).
--
-- Browsers can read tenders like sales and cannot write them.
--
-- Backfill: one tender per existing sale (amount = total, card details from the
-- hala_* columns), so readers move to tenders with no special case for old sales.
-- Report functions below now take cash/card amounts from tenders; for single-tender
-- sales the figures are unchanged.

CREATE TABLE public.sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales_transactions(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid,
  method public.payment_method NOT NULL,
  -- What this tender paid of the sale (negative on a void mirror).
  amount numeric(12,2) NOT NULL,
  -- Cash only: what the customer handed over, and the change given back.
  tendered numeric(12,2),
  change_given numeric(12,2),
  -- Card only: the terminal / gateway approval for exactly this amount.
  card_provider text,
  card_status text,
  card_reference text,
  card_response jsonb,
  position smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_payments_not_split CHECK (method <> 'split'),
  CONSTRAINT sale_payments_cash_fields CHECK (method = 'cash' OR (tendered IS NULL AND change_given IS NULL)),
  CONSTRAINT sale_payments_change CHECK (change_given IS NULL OR change_given >= 0),
  CONSTRAINT sale_payments_card_fields CHECK (method = 'card' OR (card_provider IS NULL AND card_status IS NULL AND card_reference IS NULL))
);

COMMENT ON TABLE public.sale_payments IS
  'Tenders of a POS sale (split payments). Written by the API and by sync_single_sale_tender; tenders add up to the sale total.';

CREATE INDEX sale_payments_sale_id_idx ON public.sale_payments (sale_id);
CREATE INDEX sale_payments_restaurant_idx ON public.sale_payments (restaurant_id, created_at);
-- One Moyasar payment pays at most one tender.
CREATE UNIQUE INDEX sale_payments_moyasar_ref_key ON public.sale_payments (card_reference)
  WHERE card_provider = 'moyasar' AND card_reference IS NOT NULL AND amount > 0;

-- ---- access: read like sales, no browser writes -----------------------------------
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sale payments in their restaurant"
  ON public.sale_payments FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Branch pin restriction"
  ON public.sale_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id))
  WITH CHECK (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id));

REVOKE ALL ON public.sale_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sale_payments TO authenticated;
GRANT ALL ON public.sale_payments TO service_role;

-- ---- backfill: one tender per existing sale ----------------------------------------
INSERT INTO public.sale_payments
  (sale_id, restaurant_id, branch_id, method, amount, card_provider, card_status, card_reference, card_response, created_at)
SELECT st.id, st.restaurant_id, st.branch_id, st.payment_method, COALESCE(st.total, 0),
       CASE WHEN st.payment_method = 'card' AND st.hala_status IS NOT NULL
            THEN COALESCE(st.hala_response->>'provider', 'hala') END,
       CASE WHEN st.payment_method = 'card' THEN st.hala_status END,
       CASE WHEN st.payment_method = 'card' THEN st.hala_reference END,
       CASE WHEN st.payment_method = 'card' THEN st.hala_response END,
       st.created_at
FROM public.sales_transactions st
WHERE st.payment_method IS NOT NULL AND st.payment_method <> 'split';

-- ---- single-tender sales keep their tender in step ---------------------------------
CREATE OR REPLACE FUNCTION public.sync_single_sale_tender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    UPDATE public.sale_payments SET branch_id = NEW.branch_id WHERE sale_id = NEW.id;
  END IF;

  -- Split sales: their writer (the API) records the tenders.
  IF NEW.payment_method IS NULL OR NEW.payment_method = 'split' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
     AND NEW.total IS NOT DISTINCT FROM OLD.total
     AND NEW.hala_status IS NOT DISTINCT FROM OLD.hala_status
     AND NEW.hala_reference IS NOT DISTINCT FROM OLD.hala_reference
     AND EXISTS (SELECT 1 FROM public.sale_payments WHERE sale_id = NEW.id) THEN
    RETURN NULL;
  END IF;

  -- Cash details (tendered / change) survive an amount-only change of a cash sale.
  IF TG_OP = 'UPDATE' AND NEW.payment_method = OLD.payment_method THEN
    UPDATE public.sale_payments
       SET amount = COALESCE(NEW.total, 0),
           card_status = CASE WHEN NEW.payment_method = 'card' THEN NEW.hala_status END,
           card_reference = CASE WHEN NEW.payment_method = 'card' THEN NEW.hala_reference END,
           card_response = CASE WHEN NEW.payment_method = 'card' THEN NEW.hala_response END,
           card_provider = CASE WHEN NEW.payment_method = 'card' AND NEW.hala_status IS NOT NULL
                                THEN COALESCE(NEW.hala_response->>'provider', card_provider, 'hala') END,
           tendered = CASE WHEN tendered IS NOT NULL AND tendered >= COALESCE(NEW.total, 0) THEN tendered END,
           change_given = CASE WHEN tendered IS NOT NULL AND tendered >= COALESCE(NEW.total, 0)
                               THEN tendered - COALESCE(NEW.total, 0) END
     WHERE sale_id = NEW.id;
    IF FOUND AND (SELECT count(*) FROM public.sale_payments WHERE sale_id = NEW.id) = 1 THEN
      RETURN NULL;
    END IF;
  END IF;

  DELETE FROM public.sale_payments WHERE sale_id = NEW.id;
  INSERT INTO public.sale_payments
    (sale_id, restaurant_id, branch_id, method, amount, card_provider, card_status, card_reference, card_response, created_at)
  VALUES (
    NEW.id, NEW.restaurant_id, NEW.branch_id, NEW.payment_method, COALESCE(NEW.total, 0),
    CASE WHEN NEW.payment_method = 'card' AND NEW.hala_status IS NOT NULL
         THEN COALESCE(NEW.hala_response->>'provider', 'hala') END,
    CASE WHEN NEW.payment_method = 'card' THEN NEW.hala_status END,
    CASE WHEN NEW.payment_method = 'card' THEN NEW.hala_reference END,
    CASE WHEN NEW.payment_method = 'card' THEN NEW.hala_response END,
    COALESCE(NEW.created_at, now()));
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_single_sale_tender() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_sync_single_sale_tender
  AFTER INSERT OR UPDATE OF payment_method, total, branch_id, hala_status, hala_reference, hala_response
  ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_single_sale_tender();

-- ---- at commit: tenders add up to the sale total -----------------------------------
CREATE OR REPLACE FUNCTION public.check_sale_tenders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id uuid;
  v_sale record;
  v_count int;
  v_sum numeric;
BEGIN
  IF TG_TABLE_NAME = 'sales_transactions' THEN
    v_sale_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_sale_id := OLD.sale_id;
  ELSE
    v_sale_id := NEW.sale_id;
  END IF;
  SELECT id, payment_method, COALESCE(total, 0) AS total INTO v_sale
    FROM public.sales_transactions WHERE id = v_sale_id;
  IF NOT FOUND OR v_sale.payment_method IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_count, v_sum
    FROM public.sale_payments WHERE sale_id = v_sale_id;
  IF v_sale.payment_method = 'split' AND v_count < 2 THEN
    RAISE EXCEPTION 'Split sale % needs at least two tenders', v_sale_id USING ERRCODE = '23514';
  END IF;
  IF v_sale.payment_method <> 'split' AND v_count <> 1 THEN
    RAISE EXCEPTION 'Sale % paid by % needs exactly one tender, has %', v_sale_id, v_sale.payment_method, v_count USING ERRCODE = '23514';
  END IF;
  IF abs(v_sum - v_sale.total) >= 0.005 THEN
    RAISE EXCEPTION 'Tenders of sale % add up to %, not the sale total %', v_sale_id, v_sum, v_sale.total USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_sale_tenders() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER trg_check_sale_tenders
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_sale_tenders();

CREATE CONSTRAINT TRIGGER trg_check_sale_tenders
  AFTER INSERT OR UPDATE OF payment_method, total ON public.sales_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_sale_tenders();

-- ---- report functions read tenders ---------------------------------------------

CREATE OR REPLACE FUNCTION public.dashboard_sales_summary(p_restaurant_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(net_sales numeric, total_transactions bigint, cash_sales numeric, cash_transactions bigint, card_sales numeric, card_transactions bigint, paid_sales numeric, unpaid_sales numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT can_access_restaurant(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied to restaurant %', p_restaurant_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(s.total), 0)::numeric                                                       AS net_sales,
    COUNT(*)::bigint                                                                          AS total_transactions,
    COALESCE(SUM(tp.cash), 0)::numeric              AS cash_sales,
    COUNT(*) FILTER (WHERE tp.cash IS NOT NULL)::bigint                               AS cash_transactions,
    COALESCE(SUM(tp.card), 0)::numeric              AS card_sales,
    COUNT(*) FILTER (WHERE tp.card IS NOT NULL)::bigint                               AS card_transactions,
    COALESCE(SUM(s.total) FILTER (WHERE s.settlement_status <> 'unpaid'), 0)::numeric        AS paid_sales,
    COALESCE(SUM(s.total) FILTER (WHERE s.settlement_status = 'unpaid'), 0)::numeric         AS unpaid_sales
  FROM public.sales_transactions s
  -- Cash / card parts of each sale from its tenders (split payments).
  LEFT JOIN LATERAL (
    SELECT SUM(sp.amount) FILTER (WHERE sp.method = 'cash') AS cash,
           SUM(sp.amount) FILTER (WHERE sp.method = 'card') AS card
    FROM public.sale_payments sp WHERE sp.sale_id = s.id
  ) tp ON true
  WHERE s.restaurant_id = p_restaurant_id
    AND s.created_at >= p_start
    AND s.created_at <  p_end;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dashboard_sales_summary(p_restaurant_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(net_sales numeric, total_transactions bigint, cash_sales numeric, cash_transactions bigint, card_sales numeric, card_transactions bigint, paid_sales numeric, unpaid_sales numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT can_access_restaurant(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied to restaurant %', p_restaurant_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(s.total), 0)::numeric                                                       AS net_sales,
    COUNT(*)::bigint                                                                          AS total_transactions,
    COALESCE(SUM(tp.cash), 0)::numeric              AS cash_sales,
    COUNT(*) FILTER (WHERE tp.cash IS NOT NULL)::bigint                               AS cash_transactions,
    COALESCE(SUM(tp.card), 0)::numeric              AS card_sales,
    COUNT(*) FILTER (WHERE tp.card IS NOT NULL)::bigint                               AS card_transactions,
    COALESCE(SUM(s.total) FILTER (WHERE s.settlement_status <> 'unpaid'), 0)::numeric        AS paid_sales,
    COALESCE(SUM(s.total) FILTER (WHERE s.settlement_status = 'unpaid'), 0)::numeric         AS unpaid_sales
  FROM public.sales_transactions s
  -- Cash / card parts of each sale from its tenders (split payments).
  LEFT JOIN LATERAL (
    SELECT SUM(sp.amount) FILTER (WHERE sp.method = 'cash') AS cash,
           SUM(sp.amount) FILTER (WHERE sp.method = 'card') AS card
    FROM public.sale_payments sp WHERE sp.sale_id = s.id
  ) tp ON true
  WHERE s.restaurant_id = p_restaurant_id
    AND s.created_at >= p_start
    AND s.created_at <  p_end
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.branch_performance_summary(p_restaurant_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(branch_id uuid, branch_name text, branch_code text, is_primary boolean, net_sales numeric, total_transactions bigint, paid_sales numeric, unpaid_sales numeric, cash_sales numeric, card_sales numeric, total_expenses numeric, cogs_amount numeric, labor_amount numeric, prime_cost numeric, prime_cost_pct numeric, cash_variance_total numeric, closed_shifts_count bigint, perfect_shifts_count bigint, avg_ticket numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT can_access_restaurant(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied to restaurant %', p_restaurant_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH br AS (
    SELECT b.id, b.name, b.code, b.is_primary
    FROM public.branches b
    WHERE b.restaurant_id = p_restaurant_id
      AND b.deleted_at IS NULL
  ),
  sales AS (
    SELECT
      st.branch_id,
      COALESCE(SUM(st.total),0)::numeric AS net_sales,
      COUNT(*)::bigint AS total_transactions,
      COALESCE(SUM(st.total) FILTER (WHERE st.settlement_status <> 'unpaid'),0)::numeric AS paid_sales,
      COALESCE(SUM(st.total) FILTER (WHERE st.settlement_status =  'unpaid'),0)::numeric AS unpaid_sales,
      COALESCE(SUM(tp.cash),0)::numeric AS cash_sales,
      COALESCE(SUM(tp.card),0)::numeric AS card_sales
    FROM public.sales_transactions st
    LEFT JOIN LATERAL (
      SELECT SUM(sp.amount) FILTER (WHERE sp.method = 'cash') AS cash,
             SUM(sp.amount) FILTER (WHERE sp.method = 'card') AS card
      FROM public.sale_payments sp WHERE sp.sale_id = st.id
    ) tp ON true
    WHERE st.restaurant_id = p_restaurant_id
      AND st.created_at >= p_start_date::timestamptz
      AND st.created_at <  (p_end_date + INTERVAL '1 day')::timestamptz
    GROUP BY st.branch_id
  ),
  exp AS (
    SELECT
      e.branch_id,
      COALESCE(SUM(e.amount),0)::numeric AS total_expenses,
      COALESCE(SUM(e.amount) FILTER (WHERE coa.account_type = 'cogs'),0)::numeric AS cogs_amount,
      COALESCE(SUM(e.amount) FILTER (WHERE coa.account_code LIKE '61%'),0)::numeric AS labor_amount
    FROM public.expenses e
    LEFT JOIN public.chart_of_accounts coa ON coa.id = e.account_id
    WHERE e.restaurant_id = p_restaurant_id
      AND e.deleted_at IS NULL
      AND e.expense_date BETWEEN p_start_date AND p_end_date
    GROUP BY e.branch_id
  ),
  shf AS (
    SELECT
      s.branch_id,
      COALESCE(SUM(ABS(COALESCE(s.variance,0))),0)::numeric AS cash_variance_total,
      COUNT(*) FILTER (WHERE s.status = 'closed')::bigint AS closed_shifts_count,
      COUNT(*) FILTER (WHERE s.status = 'closed' AND ABS(COALESCE(s.variance,0)) < 1)::bigint AS perfect_shifts_count
    FROM public.shifts s
    WHERE s.restaurant_id = p_restaurant_id
      AND s.status = 'closed'
      AND s.closed_at >= p_start_date::timestamptz
      AND s.closed_at <  (p_end_date + INTERVAL '1 day')::timestamptz
    GROUP BY s.branch_id
  )
  SELECT
    br.id,
    br.name,
    br.code,
    br.is_primary,
    COALESCE(sales.net_sales,0),
    COALESCE(sales.total_transactions,0),
    COALESCE(sales.paid_sales,0),
    COALESCE(sales.unpaid_sales,0),
    COALESCE(sales.cash_sales,0),
    COALESCE(sales.card_sales,0),
    COALESCE(exp.total_expenses,0),
    COALESCE(exp.cogs_amount,0),
    COALESCE(exp.labor_amount,0),
    (COALESCE(exp.cogs_amount,0) + COALESCE(exp.labor_amount,0))::numeric AS prime_cost,
    CASE WHEN COALESCE(sales.net_sales,0) > 0
      THEN ((COALESCE(exp.cogs_amount,0) + COALESCE(exp.labor_amount,0)) / sales.net_sales) * 100
      ELSE 0 END::numeric AS prime_cost_pct,
    COALESCE(shf.cash_variance_total,0),
    COALESCE(shf.closed_shifts_count,0),
    COALESCE(shf.perfect_shifts_count,0),
    CASE WHEN COALESCE(sales.total_transactions,0) > 0
      THEN sales.net_sales / sales.total_transactions ELSE 0 END::numeric AS avg_ticket
  FROM br
  LEFT JOIN sales ON sales.branch_id = br.id
  LEFT JOIN exp   ON exp.branch_id   = br.id
  LEFT JOIN shf   ON shf.branch_id   = br.id
  ORDER BY br.is_primary DESC, br.name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_card_analysis_section(p_tenant_id uuid, p_from_date date, p_to_date date, p_branch_id uuid, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_default_currency text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
    RAISE EXCEPTION 'A valid reporting period is required';
  END IF;

  IF NOT public.user_belongs_to_tenant(auth.uid(), p_tenant_id)
     AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE b.id = p_branch_id
      AND b.deleted_at IS NULL
      AND r.tenant_id = p_tenant_id
      AND public.user_can_access_branch(auth.uid(), b.restaurant_id, b.id)
  ) THEN
    RAISE EXCEPTION 'Branch access denied';
  END IF;

  SELECT COALESCE(r.currency, 'SAR')
  INTO v_default_currency
  FROM public.restaurants r
  WHERE r.tenant_id = p_tenant_id
  ORDER BY r.is_primary DESC, r.created_at ASC
  LIMIT 1;

  WITH accessible AS (
    SELECT r.id AS restaurant_id,
           COALESCE(r.currency, v_default_currency, 'SAR')::text AS currency_code,
           COALESCE(r.timezone, 'Asia/Riyadh')::text AS tz
    FROM public.restaurants r
    WHERE r.tenant_id = p_tenant_id
  ),
  tx AS (
    SELECT
      st.id,
      st.branch_id,
      a.currency_code,
      COALESCE(sp.method, st.payment_method)::text AS method,
      -- Amount of this tender; a split sale contributes one row per tender, and
      -- sale-level counts below count distinct sales (id).
      COALESCE(sp.amount, st.total, 0)::numeric AS total,
      COALESCE(st.total, 0)::numeric AS sale_total,
      (st.created_at AT TIME ZONE a.tz) AS local_ts
    FROM public.sales_transactions st
    JOIN accessible a ON a.restaurant_id = st.restaurant_id
    LEFT JOIN public.sale_payments sp ON sp.sale_id = st.id
    WHERE a.currency_code = p_currency
      AND (st.created_at AT TIME ZONE a.tz)::date BETWEEN p_from_date AND p_to_date
      AND (p_branch_id IS NULL OR st.branch_id = p_branch_id)
      AND (
        st.branch_id IS NULL
        OR public.user_can_access_branch(auth.uid(), st.restaurant_id, st.branch_id)
      )
  ),
  banded AS (
    SELECT *,
      CASE
        WHEN sale_total <= 5 THEN '0-5'
        WHEN sale_total <= 10 THEN '5-10'
        WHEN sale_total <= 15 THEN '10-15'
        WHEN sale_total <= 20 THEN '15-20'
        WHEN sale_total <= 30 THEN '20-30'
        WHEN sale_total <= 50 THEN '30-50'
        WHEN sale_total <= 100 THEN '50-100'
        ELSE '100+'
      END AS band
    FROM tx
  )
  SELECT jsonb_build_object(
    'currency', p_currency,
    'fromDate', p_from_date,
    'toDate', p_to_date,
    'totals', (
      SELECT jsonb_build_object(
        'sales', COALESCE(SUM(total), 0),
        'transactions', COUNT(DISTINCT id),
        'avgTicket', CASE WHEN COUNT(*) = 0 THEN 0 ELSE COALESCE(SUM(total), 0) / COUNT(DISTINCT id) END,
        'medianTicket', COALESCE((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s1.sale_total)
                                  FROM (SELECT DISTINCT ON (id) id, sale_total FROM tx) s1), 0),
        'days', COUNT(DISTINCT local_ts::date)
      ) FROM tx
    ),
    'methods', COALESCE((
      SELECT jsonb_agg(m ORDER BY (m->>'sales')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'method', method,
          'sales', SUM(total),
          'transactions', COUNT(DISTINCT id),
          'avgTicket', SUM(total) / NULLIF(COUNT(DISTINCT id), 0),
          'medianTicket', percentile_cont(0.5) WITHIN GROUP (ORDER BY total)
        ) AS m
        FROM tx GROUP BY method
      ) s
    ), '[]'::jsonb),
    'daily', COALESCE((
      SELECT jsonb_agg(d ORDER BY (d->>'date'))
      FROM (
        SELECT jsonb_build_object(
          'date', local_ts::date,
          'cash', SUM(total) FILTER (WHERE method = 'cash'),
          'card', SUM(total) FILTER (WHERE method = 'card'),
          'other', SUM(total) FILTER (WHERE method NOT IN ('cash','card')),
          'total', SUM(total),
          'cashTransactions', COUNT(DISTINCT id) FILTER (WHERE method = 'cash'),
          'cardTransactions', COUNT(DISTINCT id) FILTER (WHERE method = 'card'),
          'transactions', COUNT(DISTINCT id),
          'avgTicket', SUM(total) / NULLIF(COUNT(DISTINCT id), 0)
        ) AS d
        FROM tx GROUP BY local_ts::date
      ) s
    ), '[]'::jsonb),
    'bands', COALESCE((
      SELECT jsonb_agg(b ORDER BY (b->>'sort')::int)
      FROM (
        SELECT jsonb_build_object(
          'band', band,
          'sort', CASE band WHEN '0-5' THEN 1 WHEN '5-10' THEN 2 WHEN '10-15' THEN 3 WHEN '15-20' THEN 4
                            WHEN '20-30' THEN 5 WHEN '30-50' THEN 6 WHEN '50-100' THEN 7 ELSE 8 END,
          'cashTransactions', COUNT(DISTINCT id) FILTER (WHERE method = 'cash'),
          'cardTransactions', COUNT(DISTINCT id) FILTER (WHERE method = 'card'),
          'transactions', COUNT(DISTINCT id),
          'sales', SUM(total)
        ) AS b
        FROM banded GROUP BY band
      ) s
    ), '[]'::jsonb),
    'hours', COALESCE((
      SELECT jsonb_agg(h ORDER BY (h->>'hour')::int)
      FROM (
        SELECT jsonb_build_object(
          'hour', EXTRACT(HOUR FROM local_ts)::int,
          'cash', SUM(total) FILTER (WHERE method = 'cash'),
          'card', SUM(total) FILTER (WHERE method = 'card'),
          'total', SUM(total),
          'transactions', COUNT(DISTINCT id),
          'avgTicket', SUM(total) / NULLIF(COUNT(DISTINCT id), 0)
        ) AS h
        FROM tx GROUP BY EXTRACT(HOUR FROM local_ts)::int
      ) s
    ), '[]'::jsonb),
    'weekdays', COALESCE((
      SELECT jsonb_agg(w ORDER BY (w->>'dow')::int)
      FROM (
        SELECT jsonb_build_object(
          'dow', EXTRACT(ISODOW FROM local_ts)::int,
          'cash', SUM(total) FILTER (WHERE method = 'cash'),
          'card', SUM(total) FILTER (WHERE method = 'card'),
          'total', SUM(total),
          'transactions', COUNT(DISTINCT id),
          'days', COUNT(DISTINCT local_ts::date),
          'avgTicket', SUM(total) / NULLIF(COUNT(DISTINCT id), 0)
        ) AS w
        FROM tx GROUP BY EXTRACT(ISODOW FROM local_ts)::int
      ) s
    ), '[]'::jsonb),
    'branches', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'total')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'branchId', t.branch_id,
          'branchName', COALESCE(b.name, 'Unassigned'),
          'currencyCode', t.currency_code,
          'cash', SUM(t.total) FILTER (WHERE t.method = 'cash'),
          'card', SUM(t.total) FILTER (WHERE t.method = 'card'),
          'other', SUM(t.total) FILTER (WHERE t.method NOT IN ('cash','card')),
          'total', SUM(t.total),
          'cashTransactions', COUNT(DISTINCT t.id) FILTER (WHERE t.method = 'cash'),
          'cardTransactions', COUNT(DISTINCT t.id) FILTER (WHERE t.method = 'card'),
          'transactions', COUNT(DISTINCT t.id),
          'avgTicket', SUM(t.total) / NULLIF(COUNT(DISTINCT t.id), 0)
        ) AS x
        FROM tx t
        LEFT JOIN public.branches b ON b.id = t.branch_id
        GROUP BY t.branch_id, b.name, t.currency_code
      ) s
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_journal(p_tenant_id uuid, p_from_date date, p_to_date date, p_branch_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(line_id text, sold_at timestamp with time zone, business_date date, branch_id uuid, branch_name text, currency_code text, receipt_number text, transaction_id uuid, payment_method text, menu_item_id uuid, item_name text, category text, quantity numeric, unit_price numeric, line_total numeric, has_item_detail boolean, total_rows bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_default_currency text;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(BTRIM(COALESCE(p_search, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
    RAISE EXCEPTION 'A valid reporting period is required';
  END IF;

  IF NOT public.user_belongs_to_tenant(auth.uid(), p_tenant_id)
     AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.branches b
    JOIN public.restaurants r ON r.id = b.restaurant_id
    WHERE b.id = p_branch_id
      AND b.deleted_at IS NULL
      AND r.tenant_id = p_tenant_id
      AND public.user_can_access_branch(auth.uid(), b.restaurant_id, b.id)
  ) THEN
    RAISE EXCEPTION 'Branch access denied';
  END IF;

  SELECT COALESCE(r.currency, 'SAR')
  INTO v_default_currency
  FROM public.restaurants r
  WHERE r.tenant_id = p_tenant_id
  ORDER BY r.is_primary DESC, r.created_at ASC
  LIMIT 1;

  RETURN QUERY
  WITH accessible AS (
    SELECT r.id AS restaurant_id,
           COALESCE(r.currency, v_default_currency, 'SAR')::text AS currency_code,
           COALESCE(r.timezone, 'Asia/Riyadh')::text AS tz
    FROM public.restaurants r
    WHERE r.tenant_id = p_tenant_id
  ),
  txns AS (
    SELECT st.*, a.currency_code, a.tz
    FROM public.sales_transactions st
    JOIN accessible a ON a.restaurant_id = st.restaurant_id
    WHERE (st.created_at AT TIME ZONE a.tz)::date BETWEEN p_from_date AND p_to_date
      AND (p_branch_id IS NULL OR st.branch_id = p_branch_id)
      AND (
        st.branch_id IS NULL
        OR public.user_can_access_branch(auth.uid(), st.restaurant_id, st.branch_id)
      )
  ),
  rows AS (
    SELECT
      si.id::text AS line_id,
      t.created_at AS sold_at,
      (t.created_at AT TIME ZONE t.tz)::date AS business_date,
      t.branch_id,
      COALESCE(b.name, 'Unassigned')::text AS branch_name,
      t.currency_code,
      COALESCE(t.receipt_number, '')::text AS receipt_number,
      t.id AS transaction_id,
      -- A split sale shows its tenders, e.g. 'card+cash'.
      CASE WHEN t.payment_method = 'split'
           THEN COALESCE((SELECT string_agg(DISTINCT sp.method::text, '+') FROM public.sale_payments sp WHERE sp.sale_id = t.id), 'split')
           ELSE COALESCE(t.payment_method::text, '') END::text AS payment_method,
      si.menu_item_id,
      COALESCE(mi.name, 'Unknown item')::text AS item_name,
      COALESCE(mi.category, 'Uncategorized')::text AS category,
      COALESCE(si.quantity, 0)::numeric AS quantity,
      COALESCE(si.unit_price, 0)::numeric AS unit_price,
      COALESCE(si.total_price, 0)::numeric AS line_total,
      true AS has_item_detail
    FROM txns t
    JOIN public.sales_items si ON si.transaction_id = t.id
    LEFT JOIN public.branches b ON b.id = t.branch_id
    LEFT JOIN public.menu_items mi ON mi.id = si.menu_item_id

    UNION ALL

    SELECT
      t.id::text AS line_id,
      t.created_at AS sold_at,
      (t.created_at AT TIME ZONE t.tz)::date AS business_date,
      t.branch_id,
      COALESCE(b.name, 'Unassigned')::text AS branch_name,
      t.currency_code,
      COALESCE(t.receipt_number, '')::text AS receipt_number,
      t.id AS transaction_id,
      -- A split sale shows its tenders, e.g. 'card+cash'.
      CASE WHEN t.payment_method = 'split'
           THEN COALESCE((SELECT string_agg(DISTINCT sp.method::text, '+') FROM public.sale_payments sp WHERE sp.sale_id = t.id), 'split')
           ELSE COALESCE(t.payment_method::text, '') END::text AS payment_method,
      NULL::uuid AS menu_item_id,
      'Sale without item detail'::text AS item_name,
      'Summary'::text AS category,
      1::numeric AS quantity,
      COALESCE(t.total, 0)::numeric AS unit_price,
      COALESCE(t.total, 0)::numeric AS line_total,
      false AS has_item_detail
    FROM txns t
    LEFT JOIN public.branches b ON b.id = t.branch_id
    WHERE NOT EXISTS (SELECT 1 FROM public.sales_items si WHERE si.transaction_id = t.id)
  ),
  filtered AS (
    SELECT * FROM rows r
    WHERE v_search IS NULL
      OR r.item_name ILIKE '%' || v_search || '%'
      OR r.receipt_number ILIKE '%' || v_search || '%'
      OR r.category ILIKE '%' || v_search || '%'
      OR r.branch_name ILIKE '%' || v_search || '%'
  )
  SELECT
    f.line_id,
    f.sold_at,
    f.business_date,
    f.branch_id,
    f.branch_name,
    f.currency_code,
    f.receipt_number,
    f.transaction_id,
    f.payment_method,
    f.menu_item_id,
    f.item_name,
    f.category,
    f.quantity,
    f.unit_price,
    f.line_total,
    f.has_item_detail,
    COUNT(*) OVER ()::bigint AS total_rows
  FROM filtered f
  ORDER BY f.sold_at DESC, f.receipt_number DESC, f.item_name ASC
  LIMIT v_limit OFFSET v_offset;
END;
$function$;
