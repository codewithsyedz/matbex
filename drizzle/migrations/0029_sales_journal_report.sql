CREATE OR REPLACE FUNCTION public.get_sales_journal(
  p_tenant_id uuid,
  p_from_date date,
  p_to_date date,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  line_id text,
  sold_at timestamptz,
  business_date date,
  branch_id uuid,
  branch_name text,
  currency_code text,
  receipt_number text,
  transaction_id uuid,
  payment_method text,
  menu_item_id uuid,
  item_name text,
  category text,
  quantity numeric,
  unit_price numeric,
  line_total numeric,
  has_item_detail boolean,
  total_rows bigint
)
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
      COALESCE(t.payment_method::text, '')::text AS payment_method,
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
      COALESCE(t.payment_method::text, '')::text AS payment_method,
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

REVOKE ALL ON FUNCTION public.get_sales_journal(uuid, date, date, uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_journal(uuid, date, date, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_journal(uuid, date, date, uuid, text, integer, integer) TO service_role;