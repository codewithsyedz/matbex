
CREATE OR REPLACE FUNCTION public.dashboard_sales_summary(
  p_restaurant_id uuid,
  p_start timestamp with time zone,
  p_end timestamp with time zone,
  p_branch_id uuid DEFAULT NULL
)
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
    COALESCE(SUM(s.total) FILTER (WHERE s.payment_method = 'cash'), 0)::numeric              AS cash_sales,
    COUNT(*) FILTER (WHERE s.payment_method = 'cash')::bigint                                 AS cash_transactions,
    COALESCE(SUM(s.total) FILTER (WHERE s.payment_method = 'card'), 0)::numeric              AS card_sales,
    COUNT(*) FILTER (WHERE s.payment_method = 'card')::bigint                                 AS card_transactions,
    COALESCE(SUM(s.total) FILTER (WHERE s.settlement_status <> 'unpaid'), 0)::numeric        AS paid_sales,
    COALESCE(SUM(s.total) FILTER (WHERE s.settlement_status = 'unpaid'), 0)::numeric         AS unpaid_sales
  FROM public.sales_transactions s
  WHERE s.restaurant_id = p_restaurant_id
    AND s.created_at >= p_start
    AND s.created_at <  p_end
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_expense_summary(
  p_restaurant_id uuid,
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(total_expenses numeric, total_count bigint, paid_expenses numeric, unpaid_expenses numeric)
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
    COALESCE(SUM(e.amount), 0)::numeric                                            AS total_expenses,
    COUNT(*)::bigint                                                                AS total_count,
    COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'paid'), 0)::numeric           AS paid_expenses,
    COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'unpaid'), 0)::numeric         AS unpaid_expenses
  FROM public.expenses e
  WHERE e.restaurant_id = p_restaurant_id
    AND e.deleted_at IS NULL
    AND e.expense_date >= p_start_date
    AND e.expense_date <= p_end_date
    AND (p_branch_id IS NULL OR e.branch_id = p_branch_id);
END;
$function$;
