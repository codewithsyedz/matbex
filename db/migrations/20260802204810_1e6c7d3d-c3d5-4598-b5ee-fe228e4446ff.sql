CREATE OR REPLACE FUNCTION public.get_branch_menu_prices(_branch_id uuid, _at date DEFAULT CURRENT_DATE)
 RETURNS TABLE(menu_item_id uuid, quarter_price numeric, half_price numeric, full_price numeric, cost_override numeric, effective_from date, effective_to date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (p.menu_item_id)
    p.menu_item_id,
    p.quarter_price,
    p.half_price,
    p.full_price,
    p.cost_override,
    p.effective_from,
    p.effective_to
  FROM public.menu_item_branch_prices p
  WHERE p.branch_id = _branch_id
    AND p.effective_from <= _at
    AND (p.effective_to IS NULL OR p.effective_to >= _at)
  ORDER BY p.menu_item_id,
           p.effective_from DESC,
           p.created_at DESC,
           p.id DESC;
$function$;