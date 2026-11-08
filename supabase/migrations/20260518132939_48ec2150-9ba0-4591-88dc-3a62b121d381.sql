
CREATE OR REPLACE FUNCTION public.branch_performance_summary(
  p_restaurant_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  branch_id uuid,
  branch_name text,
  branch_code text,
  is_primary boolean,
  net_sales numeric,
  total_transactions bigint,
  paid_sales numeric,
  unpaid_sales numeric,
  cash_sales numeric,
  card_sales numeric,
  total_expenses numeric,
  cogs_amount numeric,
  labor_amount numeric,
  prime_cost numeric,
  prime_cost_pct numeric,
  cash_variance_total numeric,
  closed_shifts_count bigint,
  perfect_shifts_count bigint,
  avg_ticket numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      COALESCE(SUM(st.total) FILTER (WHERE st.payment_method = 'cash'),0)::numeric AS cash_sales,
      COALESCE(SUM(st.total) FILTER (WHERE st.payment_method = 'card'),0)::numeric AS card_sales
    FROM public.sales_transactions st
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
$$;

GRANT EXECUTE ON FUNCTION public.branch_performance_summary(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.branch_shift_summary(
  p_restaurant_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  shift_id uuid,
  branch_id uuid,
  branch_name text,
  cashier_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  opening_float numeric,
  expected_cash numeric,
  counted_cash numeric,
  variance numeric,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT can_access_restaurant(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied to restaurant %', p_restaurant_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.branch_id,
    COALESCE(b.name, 'Unassigned')::text,
    COALESCE(stf.name, p.full_name, 'Unknown')::text,
    s.opened_at,
    s.closed_at,
    s.opening_float,
    s.expected_cash,
    s.counted_cash,
    s.variance,
    s.status::text
  FROM public.shifts s
  LEFT JOIN public.branches b   ON b.id   = s.branch_id
  LEFT JOIN public.staff    stf ON stf.id = s.cashier_staff_id
  LEFT JOIN public.profiles p   ON p.id   = s.cashier_user_id
  WHERE s.restaurant_id = p_restaurant_id
    AND s.opened_at >= p_start_date::timestamptz
    AND s.opened_at <  (p_end_date + INTERVAL '1 day')::timestamptz
  ORDER BY s.opened_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.branch_shift_summary(uuid, date, date) TO authenticated;
