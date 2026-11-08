CREATE OR REPLACE FUNCTION public.touch_device_presence(p_terminal_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  UPDATE public.pos_terminals
     SET last_seen_at = now()
   WHERE terminal_uid = p_terminal_id
     AND tenant_id = public.get_user_tenant_id();
  GET DIAGNOSTICS v_terminal_touched = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'licenses_updated', v_license_touched,
    'terminals_updated', v_terminal_touched,
    'at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.touch_device_presence(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_device_presence(text) TO authenticated;