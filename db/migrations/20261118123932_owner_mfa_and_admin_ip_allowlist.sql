-- Two-factor for owners of paying businesses, and an IP allow-list for SuperAdmin access.
-- Both are off until a SuperAdmin switches them on (SuperAdmin → Settings → Admin security).
--
-- Settings (platform_settings):
--   security      { "owner_mfa_required": bool }
--   admin_access  { "ip_allowlist": ["203.0.113.4/32", ...] }   empty = any network
-- The API puts the caller's IP (from the proxy chain, never from the client) in the
-- x-matbex-client-ip request header for the data API, and in the x_client_ip claim for /api/v1.

-- The caller's IP for this request, or NULL outside a request (cron, migrations, service code).
CREATE OR REPLACE FUNCTION public.request_client_ip()
RETURNS inet
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v text := coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-matbex-client-ip',
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'x_client_ip');
BEGIN
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::inet;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.request_client_ip() TO authenticated, service_role;

-- True when SuperAdmin access is allowed from _ip (default: this request's IP). An empty list
-- allows every network; no IP (not a web request) is allowed.
CREATE OR REPLACE FUNCTION public.admin_ip_allowed(_ip inet DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_list jsonb;
  v_ip inet := coalesce(_ip, public.request_client_ip());
BEGIN
  SELECT value -> 'ip_allowlist' INTO v_list FROM public.platform_settings WHERE key = 'admin_access';
  IF v_list IS NULL OR jsonb_typeof(v_list) <> 'array' OR jsonb_array_length(v_list) = 0 THEN RETURN true; END IF;
  IF v_ip IS NULL THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_list) c(cidr)
     WHERE v_ip <<= c.cidr::inet
  );
EXCEPTION WHEN others THEN
  -- A malformed entry must not lock everyone out silently; set_admin_ip_allowlist validates.
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_ip_allowed(inet) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ip_allowed(inet) TO authenticated, service_role;

-- SuperAdmin rights for the signed-in user need a two-factor session AND an allowed network.
-- Checks about another user (e.g. "is this person a SuperAdmin?") are unchanged.
CREATE OR REPLACE FUNCTION public.is_superadmin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.superadmin_users WHERE user_id = _user_id)
     AND (
       _user_id IS DISTINCT FROM auth.uid()
       OR (COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2' AND public.admin_ip_allowed())
     );
$function$;

-- Replace the allow-list. The caller's own current network must stay allowed (no self-lockout).
-- Recovery if needed: delete the 'admin_access' row from platform_settings with database access.
CREATE OR REPLACE FUNCTION public.set_admin_ip_allowlist(_cidrs text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clean text[] := '{}';
  c text;
  v_ip inet := public.request_client_ip();
BEGIN
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'SuperAdmin access required' USING ERRCODE = '42501';
  END IF;
  FOREACH c IN ARRAY coalesce(_cidrs, '{}') LOOP
    c := btrim(c);
    CONTINUE WHEN c = '';
    BEGIN
      v_clean := v_clean || (c::inet)::text;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '"%" is not an IP address or range (e.g. 203.0.113.4 or 203.0.113.0/24)', c;
    END;
  END LOOP;
  IF array_length(v_clean, 1) > 0 AND v_ip IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(v_clean) x WHERE v_ip <<= x::inet) THEN
    RAISE EXCEPTION 'Your current address (%) is not in the list; add it first so you are not locked out', host(v_ip);
  END IF;
  INSERT INTO public.platform_settings (key, value, is_secret, description, updated_by)
  VALUES ('admin_access', jsonb_build_object('ip_allowlist', to_jsonb(v_clean)), false, 'Networks SuperAdmins may work from (empty = any)', auth.uid())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('ip_allowlist', to_jsonb(v_clean));
END;
$function$;
REVOKE ALL ON FUNCTION public.set_admin_ip_allowlist(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_ip_allowlist(text[]) TO authenticated;

-- Must this user pass two-factor before working? Owners of a paying business (active or past
-- due, on a paid plan), once security.owner_mfa_required is on.
CREATE OR REPLACE FUNCTION public.owner_mfa_required(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT (value ->> 'owner_mfa_required')::boolean FROM public.platform_settings WHERE key = 'security'), false)
     AND EXISTS (
       SELECT 1 FROM public.user_tenant_roles r
         JOIN public.tenants t ON t.id = r.tenant_id
         LEFT JOIN public.plans p ON p.id = t.plan_id
        WHERE r.user_id = _user_id AND r.role = 'owner'
          AND t.status IN ('active', 'past_due')
          AND lower(coalesce(p.name, '')) NOT IN ('', 'trial', 'free')
     );
$function$;
REVOKE ALL ON FUNCTION public.owner_mfa_required(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_mfa_required(uuid) TO authenticated, service_role;

-- What the app needs to decide whether to ask for a code: the session's level, whether this
-- user must use two-factor, and (for SuperAdmins) whether this network is allowed.
CREATE OR REPLACE FUNCTION public.session_security_status()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'aal', COALESCE(auth.jwt() ->> 'aal', 'aal1'),
    'owner_mfa_required', public.owner_mfa_required(auth.uid()),
    'is_superadmin_account', EXISTS (SELECT 1 FROM public.superadmin_users WHERE user_id = auth.uid()),
    'admin_ip_allowed', public.admin_ip_allowed(),
    'client_ip', host(public.request_client_ip())
  );
$function$;
REVOKE ALL ON FUNCTION public.session_security_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_security_status() TO authenticated;
