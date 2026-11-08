DROP FUNCTION IF EXISTS public.dashboard_settlements_summary(uuid);

CREATE OR REPLACE FUNCTION public.dashboard_settlements_summary(p_restaurant_id uuid, p_branch_id uuid DEFAULT NULL)
 RETURNS TABLE(total_unpaid_amount numeric, customers_with_balance bigint, pending_invoices bigint, overdue_invoices bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT can_access_restaurant(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied to restaurant %', p_restaurant_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH unpaid AS (
    SELECT t.customer_id, t.total
      FROM public.sales_transactions t
     WHERE t.restaurant_id = p_restaurant_id
       AND t.settlement_status = 'unpaid'
       AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
  ),
  branch_customers AS (
    SELECT DISTINCT u.customer_id FROM unpaid u WHERE u.customer_id IS NOT NULL
  )
  SELECT
    (SELECT COALESCE(SUM(u.total), 0)::numeric FROM unpaid u)                 AS total_unpaid_amount,
    CASE
      WHEN p_branch_id IS NULL THEN
        (SELECT COUNT(*)::bigint FROM public.customers c
          WHERE c.restaurant_id = p_restaurant_id AND c.current_balance > 0)
      ELSE (SELECT COUNT(*)::bigint FROM branch_customers)
    END                                                                       AS customers_with_balance,
    (SELECT COUNT(*)::bigint
       FROM public.settlement_invoices i
      WHERE i.restaurant_id = p_restaurant_id
        AND i.status IN ('pending', 'partial')
        AND (p_branch_id IS NULL OR i.customer_id IN (SELECT customer_id FROM branch_customers)))
                                                                              AS pending_invoices,
    (SELECT COUNT(*)::bigint
       FROM public.settlement_invoices i
      WHERE i.restaurant_id = p_restaurant_id
        AND i.status IN ('pending', 'partial')
        AND i.due_date IS NOT NULL
        AND i.due_date < CURRENT_DATE
        AND (p_branch_id IS NULL OR i.customer_id IN (SELECT customer_id FROM branch_customers)))
                                                                              AS overdue_invoices;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_settlements_summary(uuid, uuid) TO authenticated;