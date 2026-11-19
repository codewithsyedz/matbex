-- remove_menu_item_limits
--
-- Menus are unlimited on every plan. The plans capped menu items at 50 (trial, legacy free),
-- 75 (Starter), 100 (Growth) and 200 (Enterprise); a normal restaurant menu with variants passes
-- 100, and no competitor advertises a menu cap. The cap was only checked by the browser through
-- check_quota('menu_items'), so removing the key from the plans lifts it; check_quota also stops
-- reporting a menu limit, so a key re-added by hand in the admin plan editor has no effect.
-- tenant_usage.menu_item_count is still kept up to date (usage display, reports).

UPDATE public.plans
SET quota_limits = quota_limits - 'menu_items',
    updated_at = now()
WHERE quota_limits ? 'menu_items';

UPDATE public.addons
SET quota_boosts = quota_boosts - 'menu_items'
WHERE jsonb_typeof(quota_boosts) = 'object' AND quota_boosts ? 'menu_items';

CREATE OR REPLACE FUNCTION public.check_quota(p_tenant_id uuid, p_quota_type text, p_increment integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_limits jsonb;
  v_current_usage integer;
  v_limit integer;
  v_allowed boolean := true;
BEGIN
  PERFORM public.assert_tenant_access(p_tenant_id);

  SELECT p.quota_limits INTO v_plan_limits
  FROM public.tenants t
  JOIN public.plans p ON t.plan_id = p.id
  WHERE t.id = p_tenant_id;

  SELECT
    CASE p_quota_type
      WHEN 'users' THEN user_count
      WHEN 'menu_items' THEN menu_item_count
      WHEN 'image_uploads' THEN image_upload_count
      WHEN 'email_reminders' THEN email_reminder_count
      WHEN 'owner' THEN owner_count
      WHEN 'manager' THEN manager_count
      WHEN 'cashier' THEN cashier_count
      ELSE 0
    END INTO v_current_usage
  FROM public.tenant_usage
  WHERE tenant_id = p_tenant_id;

  v_current_usage := COALESCE(v_current_usage, 0);

  -- Menu items are never limited.
  IF p_quota_type = 'menu_items' OR v_plan_limits IS NULL OR v_plan_limits = '{}'::jsonb THEN
    RETURN jsonb_build_object('allowed', true, 'current', v_current_usage, 'limit', null, 'remaining', null);
  END IF;

  v_limit := (v_plan_limits->>p_quota_type)::integer;

  IF v_limit IS NOT NULL AND (v_current_usage + p_increment) > v_limit THEN
    v_allowed := false;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'current', v_current_usage,
    'limit', v_limit,
    'remaining', CASE WHEN v_limit IS NOT NULL THEN GREATEST(0, v_limit - v_current_usage) ELSE null END
  );
END;
$function$;
