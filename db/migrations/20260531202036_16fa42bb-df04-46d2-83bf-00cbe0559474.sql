
-- SuperAdmin subdomain governance: list + suspend/unsuspend + force rename + release

CREATE OR REPLACE FUNCTION public.admin_list_subdomains()
RETURNS TABLE(
  id uuid,
  tenant_id uuid,
  tenant_name text,
  tenant_status text,
  plan_name text,
  subdomain text,
  custom_domain text,
  domain_status text,
  ssl_status text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    td.id,
    td.tenant_id,
    t.name AS tenant_name,
    t.status AS tenant_status,
    p.name AS plan_name,
    td.subdomain,
    td.custom_domain,
    td.domain_status,
    td.ssl_status,
    td.created_at,
    td.updated_at
  FROM public.tenant_domains td
  JOIN public.tenants t ON t.id = td.tenant_id
  LEFT JOIN public.plans p ON p.id = t.plan_id
  WHERE public.is_superadmin(auth.uid())
  ORDER BY td.created_at DESC;
$$ SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_list_subdomains() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_subdomains() TO authenticated, service_role;

-- Suspend (takes the subdomain offline; landing page can render a paused state)
CREATE OR REPLACE FUNCTION public.admin_suspend_subdomain(_tenant_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Requires SuperAdmin';
  END IF;

  UPDATE public.tenant_domains
     SET domain_status = 'offline', updated_at = now()
   WHERE tenant_id = _tenant_id AND subdomain IS NOT NULL;

  INSERT INTO public.superadmin_audit_logs (actor_user_id, action, tenant_id, metadata)
  VALUES (auth.uid(), 'subdomain_suspended', _tenant_id, jsonb_build_object('reason', _reason))
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  -- audit log table may not exist in some envs; ignore
  NULL;
END;
$$ SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_suspend_subdomain(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_suspend_subdomain(uuid, text) TO authenticated, service_role;

-- Unsuspend
CREATE OR REPLACE FUNCTION public.admin_unsuspend_subdomain(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Requires SuperAdmin';
  END IF;

  UPDATE public.tenant_domains
     SET domain_status = 'active', updated_at = now()
   WHERE tenant_id = _tenant_id AND subdomain IS NOT NULL;

  BEGIN
    INSERT INTO public.superadmin_audit_logs (actor_user_id, action, tenant_id, metadata)
    VALUES (auth.uid(), 'subdomain_unsuspended', _tenant_id, '{}'::jsonb);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END;
$$ SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_unsuspend_subdomain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_unsuspend_subdomain(uuid) TO authenticated, service_role;

-- Force-rename (bypasses owner check, still respects reserved + uniqueness)
CREATE OR REPLACE FUNCTION public.admin_force_rename_subdomain(
  _tenant_id uuid,
  _new_subdomain text,
  _reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old text;
  v_clean text;
BEGIN
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Requires SuperAdmin';
  END IF;

  v_clean := public.slugify_subdomain(_new_subdomain);
  IF v_clean IS NULL THEN
    RAISE EXCEPTION 'Invalid subdomain';
  END IF;

  IF EXISTS (SELECT 1 FROM public.reserved_subdomains WHERE name = v_clean) THEN
    RAISE EXCEPTION 'That subdomain is reserved';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_domains WHERE subdomain = v_clean AND tenant_id <> _tenant_id) THEN
    RAISE EXCEPTION 'That subdomain is already taken';
  END IF;

  SELECT subdomain INTO v_old
  FROM public.tenant_domains
  WHERE tenant_id = _tenant_id AND subdomain IS NOT NULL
  LIMIT 1;

  IF v_old IS NULL THEN
    INSERT INTO public.tenant_domains (tenant_id, subdomain, domain_status, ssl_status)
    VALUES (_tenant_id, v_clean, 'active', 'active');
  ELSIF v_old <> v_clean THEN
    INSERT INTO public.tenant_slug_history (tenant_id, old_subdomain, new_subdomain, changed_by)
    VALUES (_tenant_id, v_old, v_clean, auth.uid());

    UPDATE public.tenant_domains
       SET subdomain = v_clean, updated_at = now()
     WHERE tenant_id = _tenant_id AND subdomain = v_old;
  END IF;

  BEGIN
    INSERT INTO public.superadmin_audit_logs (actor_user_id, action, tenant_id, metadata)
    VALUES (auth.uid(), 'subdomain_force_renamed', _tenant_id,
            jsonb_build_object('old', v_old, 'new', v_clean, 'reason', _reason));
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  RETURN v_clean;
END;
$$ SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_force_rename_subdomain(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_force_rename_subdomain(uuid, text, text) TO authenticated, service_role;

-- Release (remove the subdomain entirely, free the slug; records history with empty new)
CREATE OR REPLACE FUNCTION public.admin_release_subdomain(_tenant_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old text;
BEGIN
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Requires SuperAdmin';
  END IF;

  SELECT subdomain INTO v_old
  FROM public.tenant_domains
  WHERE tenant_id = _tenant_id AND subdomain IS NOT NULL
  LIMIT 1;

  IF v_old IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.tenant_domains
     SET subdomain = NULL, domain_status = 'offline', updated_at = now()
   WHERE tenant_id = _tenant_id AND subdomain = v_old;

  BEGIN
    INSERT INTO public.superadmin_audit_logs (actor_user_id, action, tenant_id, metadata)
    VALUES (auth.uid(), 'subdomain_released', _tenant_id,
            jsonb_build_object('released', v_old, 'reason', _reason));
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END;
$$ SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_release_subdomain(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_release_subdomain(uuid, text) TO authenticated, service_role;
