-- days_without_end_of_day
--
-- Days with POS sales but no End of Day at all are missing from revenue, VAT and cash in the
-- ledger (End of Day is what posts sales). On the production copy: 59 branch-days, 105,200 SAR,
-- mostly April-June 2026. Found in the CFO review of 2026-11-13. Lists them for the accountant
-- dashboard and the accountant alert email. SECURITY INVOKER: the caller's row security decides
-- what they see.

CREATE OR REPLACE FUNCTION public.days_without_end_of_day(p_restaurant_id uuid, p_branch_id uuid DEFAULT NULL)
 RETURNS TABLE(sales_date date, branch_id uuid, branch_name text, sales_count bigint, pos_total numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH tz AS (SELECT COALESCE(NULLIF(timezone, ''), 'Asia/Riyadh') AS tz FROM restaurants WHERE id = p_restaurant_id),
  days AS (
    SELECT (s.created_at AT TIME ZONE (SELECT tz FROM tz))::date AS d, s.branch_id, count(*) AS n, sum(s.total) AS t
    FROM sales_transactions s
    WHERE s.restaurant_id = p_restaurant_id
      AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
      AND s.voided_at IS NULL AND s.voids_transaction_id IS NULL
    GROUP BY 1, 2
  )
  SELECT d.d, d.branch_id, b.name, d.n, round(d.t, 2)
  FROM days d
  LEFT JOIN branches b ON b.id = d.branch_id
  WHERE d.d < (now() AT TIME ZONE (SELECT tz FROM tz))::date   -- today is still open
    AND NOT EXISTS (
      SELECT 1 FROM daily_sales_summary x
      WHERE x.restaurant_id = p_restaurant_id AND x.sales_date = d.d
        AND x.branch_id IS NOT DISTINCT FROM d.branch_id)
  ORDER BY d.d, b.name
$function$;
REVOKE ALL ON FUNCTION public.days_without_end_of_day(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.days_without_end_of_day(uuid, uuid) TO authenticated, service_role;
