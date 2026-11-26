CREATE OR REPLACE FUNCTION public.get_sales_item_breakdown(
  p_tenant_id uuid,
  p_from_date date,
  p_to_date date,
  p_branch_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  branch_id uuid,
  branch_name text,
  currency_code text,
  menu_item_id uuid,
  item_name text,
  category text,
  quantity numeric,
  revenue numeric,
  transaction_count bigint,
  unit_cost numeric,
  total_cost numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_default_currency text;
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
  item_cost AS (
    SELECT ri.menu_item_id,
           SUM(COALESCE(ri.quantity_required, 0) * COALESCE(inv.unit_cost, 0))::numeric AS unit_cost
    FROM public.recipe_ingredients ri
    JOIN public.inventory_items inv ON inv.id = ri.inventory_item_id
    WHERE ri.restaurant_id IN (SELECT restaurant_id FROM accessible)
    GROUP BY ri.menu_item_id
  ),
  lines AS (
    SELECT
      si.branch_id,
      a.currency_code,
      si.menu_item_id,
      si.quantity,
      si.total_price,
      si.transaction_id
    FROM public.sales_items si
    JOIN accessible a ON a.restaurant_id = si.restaurant_id
    WHERE (si.created_at AT TIME ZONE a.tz)::date BETWEEN p_from_date AND p_to_date
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND (
        si.branch_id IS NULL
        OR public.user_can_access_branch(auth.uid(), si.restaurant_id, si.branch_id)
      )
  )
  SELECT
    l.branch_id,
    COALESCE(b.name, 'Unassigned')::text AS branch_name,
    l.currency_code,
    l.menu_item_id,
    COALESCE(mi.name, 'Unknown item')::text AS item_name,
    COALESCE(mi.category, 'Uncategorized')::text AS category,
    SUM(COALESCE(l.quantity, 0))::numeric AS quantity,
    SUM(COALESCE(l.total_price, 0))::numeric AS revenue,
    COUNT(DISTINCT l.transaction_id)::bigint AS transaction_count,
    ic.unit_cost::numeric AS unit_cost,
    CASE WHEN ic.unit_cost IS NULL THEN NULL
         ELSE (ic.unit_cost * SUM(COALESCE(l.quantity, 0)))::numeric
    END AS total_cost
  FROM lines l
  LEFT JOIN public.branches b ON b.id = l.branch_id
  LEFT JOIN public.menu_items mi ON mi.id = l.menu_item_id
  LEFT JOIN item_cost ic ON ic.menu_item_id = l.menu_item_id
  GROUP BY l.branch_id, b.name, l.currency_code, l.menu_item_id, mi.name, mi.category, ic.unit_cost
  ORDER BY branch_name, revenue DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sales_item_breakdown(uuid, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_item_breakdown(uuid, date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_item_breakdown(uuid, date, date, uuid) TO service_role;