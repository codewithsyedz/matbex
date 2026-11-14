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
      st.payment_method::text AS method,
      COALESCE(st.total, 0)::numeric AS total,
      (st.created_at AT TIME ZONE a.tz) AS local_ts
    FROM public.sales_transactions st
    JOIN accessible a ON a.restaurant_id = st.restaurant_id
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
        WHEN total <= 5 THEN '0-5'
        WHEN total <= 10 THEN '5-10'
        WHEN total <= 15 THEN '10-15'
        WHEN total <= 20 THEN '15-20'
        WHEN total <= 30 THEN '20-30'
        WHEN total <= 50 THEN '30-50'
        WHEN total <= 100 THEN '50-100'
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
        'transactions', COUNT(*),
        'avgTicket', CASE WHEN COUNT(*) = 0 THEN 0 ELSE COALESCE(SUM(total), 0) / COUNT(*) END,
        'medianTicket', COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY total), 0),
        'days', COUNT(DISTINCT local_ts::date)
      ) FROM tx
    ),
    'methods', COALESCE((
      SELECT jsonb_agg(m ORDER BY (m->>'sales')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'method', method,
          'sales', SUM(total),
          'transactions', COUNT(*),
          'avgTicket', SUM(total) / NULLIF(COUNT(*), 0),
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
          'cashTransactions', COUNT(*) FILTER (WHERE method = 'cash'),
          'cardTransactions', COUNT(*) FILTER (WHERE method = 'card'),
          'transactions', COUNT(*),
          'avgTicket', SUM(total) / NULLIF(COUNT(*), 0)
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
          'cashTransactions', COUNT(*) FILTER (WHERE method = 'cash'),
          'cardTransactions', COUNT(*) FILTER (WHERE method = 'card'),
          'transactions', COUNT(*),
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
          'transactions', COUNT(*),
          'avgTicket', SUM(total) / NULLIF(COUNT(*), 0)
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
          'transactions', COUNT(*),
          'days', COUNT(DISTINCT local_ts::date),
          'avgTicket', SUM(total) / NULLIF(COUNT(*), 0)
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
          'cashTransactions', COUNT(*) FILTER (WHERE t.method = 'cash'),
          'cardTransactions', COUNT(*) FILTER (WHERE t.method = 'card'),
          'transactions', COUNT(*),
          'avgTicket', SUM(t.total) / NULLIF(COUNT(*), 0)
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

REVOKE ALL ON FUNCTION public.get_cash_card_analysis_section(uuid, date, date, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cash_card_analysis_section(uuid, date, date, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_cash_card_analysis(p_tenant_id uuid, p_from_date date, p_to_date date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_default text;
  v_cur text;
  v_section jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_primary jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT COALESCE(r.currency, 'SAR') INTO v_default
  FROM public.restaurants r WHERE r.tenant_id = p_tenant_id
  ORDER BY r.is_primary DESC, r.created_at ASC LIMIT 1;
  v_default := COALESCE(v_default, 'SAR');

  FOR v_cur IN
    SELECT c FROM (
      SELECT DISTINCT COALESCE(r.currency, v_default, 'SAR')::text AS c
      FROM public.restaurants r WHERE r.tenant_id = p_tenant_id
    ) x ORDER BY (c = v_default) DESC, c
  LOOP
    v_section := public.get_cash_card_analysis_section(p_tenant_id, p_from_date, p_to_date, p_branch_id, v_cur);
    IF v_primary IS NULL THEN v_primary := v_section; END IF;
    IF COALESCE((v_section->'totals'->>'transactions')::int, 0) > 0 THEN
      v_sections := v_sections || jsonb_build_array(v_section);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_sections) > 0 THEN v_primary := v_sections->0; END IF;
  RETURN COALESCE(v_primary, '{}'::jsonb) || jsonb_build_object('sections', v_sections);
END;
$function$;