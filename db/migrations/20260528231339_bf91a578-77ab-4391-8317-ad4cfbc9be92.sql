
CREATE OR REPLACE FUNCTION public.public_top_selling_items(p_restaurant_id uuid, p_limit int DEFAULT 20)
RETURNS TABLE(menu_item_id uuid, sold_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT si.menu_item_id, SUM(si.quantity)::bigint AS cnt
    FROM public.sales_items si
    WHERE si.restaurant_id = p_restaurant_id
      AND si.created_at > now() - interval '60 days'
    GROUP BY si.menu_item_id
    UNION ALL
    SELECT oi.menu_item_id, SUM(oi.qty)::bigint AS cnt
    FROM public.online_order_items oi
    JOIN public.online_orders oo ON oo.id = oi.order_id
    WHERE oo.restaurant_id = p_restaurant_id
      AND oo.created_at > now() - interval '60 days'
      AND oi.menu_item_id IS NOT NULL
    GROUP BY oi.menu_item_id
  )
  SELECT mi.id AS menu_item_id, COALESCE(SUM(c.cnt), 0) AS sold_count
  FROM public.menu_items mi
  LEFT JOIN counts c ON c.menu_item_id = mi.id
  WHERE mi.restaurant_id = p_restaurant_id
    AND mi.is_active = true
    AND mi.available_online = true
  GROUP BY mi.id
  ORDER BY sold_count DESC NULLS LAST, mi.name ASC
  LIMIT p_limit;
$$;
