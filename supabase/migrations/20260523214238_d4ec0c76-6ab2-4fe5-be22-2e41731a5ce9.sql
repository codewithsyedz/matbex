CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS admin_pin_hash text,
  ADD COLUMN IF NOT EXISTS admin_pin_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_pin_set_by uuid;

CREATE OR REPLACE FUNCTION public.set_tenant_admin_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  v_tenant := public.get_user_tenant_id(v_uid);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant for current user';
  END IF;
  IF NOT (
    public.has_tenant_role(v_uid, v_tenant, 'owner'::public.app_role)
    OR public.has_tenant_role(v_uid, v_tenant, 'manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Only owners or managers can set the admin PIN';
  END IF;
  IF p_pin IS NULL OR length(p_pin) < 4 OR length(p_pin) > 12 OR p_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN must be 4-12 digits';
  END IF;

  UPDATE public.tenants
     SET admin_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
         admin_pin_set_at = now(),
         admin_pin_set_by = v_uid,
         updated_at = now()
   WHERE id = v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_admin_pin(text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_tenant_admin_pin(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_tenant_admin_pin(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_hash text;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  v_tenant := public.get_user_tenant_id(v_uid);
  IF v_tenant IS NULL THEN RETURN false; END IF;
  IF p_pin IS NULL OR length(p_pin) < 4 OR length(p_pin) > 12 THEN RETURN false; END IF;
  SELECT admin_pin_hash INTO v_hash FROM public.tenants WHERE id = v_tenant;
  IF v_hash IS NULL THEN RETURN false; END IF;
  RETURN v_hash = extensions.crypt(p_pin, v_hash);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_tenant_admin_pin(text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_tenant_admin_pin(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.tenant_admin_pin_is_set()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(admin_pin_hash IS NOT NULL, false)
  FROM public.tenants
  WHERE id = public.get_user_tenant_id(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.tenant_admin_pin_is_set() FROM public;
GRANT EXECUTE ON FUNCTION public.tenant_admin_pin_is_set() TO authenticated;