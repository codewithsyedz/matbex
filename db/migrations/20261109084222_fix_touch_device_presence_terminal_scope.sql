-- fix_touch_device_presence_terminal_scope
--
-- touch_device_presence (20260801101349) filtered pos_terminals on a tenant_id column
-- that table has never had, and called get_user_tenant_id() without its user argument.
-- Every call failed with 42703 and rolled back, so neither device_licenses.last_seen_at
-- nor pos_terminals.last_seen_at was ever updated by the web presence ping (the client
-- swallows the error). Production's generated types show the same pos_terminals shape.
-- Scope terminals through their restaurant's tenant instead. Signature, return shape and
-- grants are unchanged (CREATE OR REPLACE keeps grants).

CREATE OR REPLACE FUNCTION public.touch_device_presence(p_terminal_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_license_touched int := 0;
  v_terminal_touched int := 0;
BEGIN
  IF auth.uid() IS NULL OR p_terminal_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  UPDATE public.device_licenses
     SET last_seen_at = now()
   WHERE terminal_id = p_terminal_id
     AND revoked_at IS NULL
     AND claimed_by_user_id = auth.uid();
  GET DIAGNOSTICS v_license_touched = ROW_COUNT;

  UPDATE public.pos_terminals t
     SET last_seen_at = now()
    FROM public.restaurants r
   WHERE t.terminal_uid = p_terminal_id
     AND r.id = t.restaurant_id
     AND r.tenant_id = public.get_user_tenant_id(auth.uid());
  GET DIAGNOSTICS v_terminal_touched = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'licenses_updated', v_license_touched,
    'terminals_updated', v_terminal_touched,
    'at', now()
  );
END;
$function$;
