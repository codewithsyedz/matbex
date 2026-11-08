-- =========================================================
-- Phase 1: Tenant subdomain auto-provisioning
-- =========================================================

-- 1. Reserved subdomains -----------------------------------
CREATE TABLE public.reserved_subdomains (
  name text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reserved_subdomains TO anon, authenticated;
GRANT ALL    ON public.reserved_subdomains TO service_role;

ALTER TABLE public.reserved_subdomains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reserved subdomains are readable by everyone"
  ON public.reserved_subdomains FOR SELECT USING (true);

INSERT INTO public.reserved_subdomains (name, reason) VALUES
  ('www','system'),('app','system'),('admin','system'),('api','system'),
  ('mail','system'),('staff','system'),('dashboard','system'),('cdn','system'),
  ('static','system'),('help','system'),('docs','system'),('blog','system'),
  ('pay','system'),('auth','system'),('billing','system'),('status','system'),
  ('support','system'),('careers','system'),('press','system'),('about','system'),
  ('login','system'),('signup','system'),('register','system'),('cloud','system'),
  ('ai','system'),('dev','system'),('test','system'),('demo','system'),
  ('beta','system'),('partners','system'),('affiliates','system'),
  ('matbex','brand'),('order','system'),('orders','system'),('kiosk','system'),
  ('cfd','system'),('driver','system'),('waiter','system'),('chat','system'),
  ('kds','system'),('pos','system'),('terminal','system'),('webhooks','system'),
  ('cdn1','system'),('cdn2','system'),('files','system'),('assets','system'),
  ('img','system'),('images','system'),('storage','system'),('s3','system'),
  ('ns1','system'),('ns2','system'),('ftp','system'),('smtp','system')
ON CONFLICT (name) DO NOTHING;

-- 2. Slug history for 90-day redirects ---------------------
CREATE TABLE public.tenant_slug_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  old_subdomain text NOT NULL,
  new_subdomain text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  redirect_until timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);

CREATE INDEX idx_tenant_slug_history_old ON public.tenant_slug_history(old_subdomain);
CREATE INDEX idx_tenant_slug_history_tenant ON public.tenant_slug_history(tenant_id);

GRANT SELECT ON public.tenant_slug_history TO anon, authenticated;
GRANT ALL    ON public.tenant_slug_history TO service_role;

ALTER TABLE public.tenant_slug_history ENABLE ROW LEVEL SECURITY;

-- public read: needed so the subdomain landing page can resolve redirects
CREATE POLICY "Slug history readable by everyone"
  ON public.tenant_slug_history FOR SELECT USING (true);

CREATE POLICY "Owners can manage their slug history"
  ON public.tenant_slug_history
  FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM public.user_tenant_roles
    WHERE user_id = auth.uid() AND role = 'owner'::app_role
  ));

-- 3. Slug sanitizer helper ---------------------------------
CREATE OR REPLACE FUNCTION public.slugify_subdomain(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
BEGIN
  IF _raw IS NULL OR length(trim(_raw)) = 0 THEN
    RETURN NULL;
  END IF;
  s := lower(trim(_raw));
  -- replace anything non-alphanumeric with hyphen
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  -- trim leading/trailing hyphens
  s := regexp_replace(s, '^-+|-+$', '', 'g');
  -- collapse repeats
  s := regexp_replace(s, '-{2,}', '-', 'g');
  -- max 40 chars for DNS sanity
  IF length(s) > 40 THEN
    s := substring(s from 1 for 40);
    s := regexp_replace(s, '-+$', '', 'g');
  END IF;
  -- subdomain may not start with a digit (DNS-friendly)
  IF s ~ '^[0-9]' THEN
    s := 'r-' || s;
  END IF;
  IF length(s) < 2 THEN
    RETURN NULL;
  END IF;
  RETURN s;
END;
$$ SET search_path = public;

-- 4. Provisioning function ---------------------------------
-- Idempotent: safe to call repeatedly. Returns the final subdomain.
CREATE OR REPLACE FUNCTION public.provision_tenant_subdomain(_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant   record;
  v_base     text;
  v_final    text;
  v_attempt  int := 0;
  v_existing record;
  v_page_id  uuid;
BEGIN
  SELECT id, name, slug INTO v_tenant
  FROM public.tenants
  WHERE id = _tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant % not found', _tenant_id;
  END IF;

  -- Already provisioned? Return existing subdomain.
  SELECT subdomain INTO v_existing
  FROM public.tenant_domains
  WHERE tenant_id = _tenant_id AND subdomain IS NOT NULL
  LIMIT 1;

  IF v_existing.subdomain IS NOT NULL THEN
    v_final := v_existing.subdomain;
  ELSE
    -- Compute candidate base slug
    v_base := public.slugify_subdomain(COALESCE(v_tenant.slug, v_tenant.name));
    IF v_base IS NULL THEN
      v_base := 't-' || substring(replace(v_tenant.id::text, '-', '') from 1 for 8);
    END IF;

    v_final := v_base;
    LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.reserved_subdomains WHERE name = v_final
      ) AND NOT EXISTS (
        SELECT 1 FROM public.tenant_domains WHERE subdomain = v_final
      ) AND NOT EXISTS (
        SELECT 1 FROM public.tenant_slug_history WHERE old_subdomain = v_final AND redirect_until > now()
      );
      v_attempt := v_attempt + 1;
      EXIT WHEN v_attempt > 50;
      v_final := v_base || '-' || (v_attempt + 1)::text;
    END LOOP;

    INSERT INTO public.tenant_domains (tenant_id, subdomain, domain_status, ssl_status)
    VALUES (_tenant_id, v_final, 'active', 'active');
  END IF;

  -- Seed landing page if missing
  SELECT id INTO v_page_id
  FROM public.tenant_pages
  WHERE tenant_id = _tenant_id AND page_type = 'landing'
  LIMIT 1;

  IF v_page_id IS NULL THEN
    INSERT INTO public.tenant_pages (
      tenant_id, page_type, theme, hero_title, hero_subtitle,
      show_menu_sync, show_hours, show_location, is_published, published_at
    ) VALUES (
      _tenant_id, 'landing', 'urban-cafe',
      v_tenant.name,
      'Order online for delivery or pickup',
      true, true, true, true, now()
    )
    RETURNING id INTO v_page_id;

    -- Seed default blocks (idempotent block-by-block)
    INSERT INTO public.tenant_page_blocks (page_id, block_type, block_order, content) VALUES
      (v_page_id, 'hero',     0, jsonb_build_object('title', v_tenant.name, 'cta_label', 'Order online')),
      (v_page_id, 'menu',     1, jsonb_build_object('limit', 6, 'show_top_selling', true)),
      (v_page_id, 'hours',    2, '{}'::jsonb),
      (v_page_id, 'location', 3, jsonb_build_object('show_map', true, 'show_phone', true)),
      (v_page_id, 'cta',      4, jsonb_build_object('label', 'Order now', 'style', 'primary'));
  END IF;

  RETURN v_final;
END;
$$ SET search_path = public;

REVOKE ALL ON FUNCTION public.provision_tenant_subdomain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_tenant_subdomain(uuid) TO authenticated, service_role;

-- 5. Slug rename helper (records history, updates tenant_domains)
CREATE OR REPLACE FUNCTION public.rename_tenant_subdomain(_tenant_id uuid, _new_subdomain text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old text;
  v_clean text;
BEGIN
  -- Only owners may rename
  IF NOT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = auth.uid() AND tenant_id = _tenant_id AND role = 'owner'::app_role
  ) THEN
    RAISE EXCEPTION 'Only owners can rename the subdomain';
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
  IF EXISTS (SELECT 1 FROM public.tenant_slug_history WHERE old_subdomain = v_clean AND redirect_until > now()) THEN
    RAISE EXCEPTION 'That subdomain is still redirecting from a previous owner';
  END IF;

  SELECT subdomain INTO v_old
  FROM public.tenant_domains WHERE tenant_id = _tenant_id AND subdomain IS NOT NULL
  LIMIT 1;

  IF v_old IS NOT NULL AND v_old <> v_clean THEN
    INSERT INTO public.tenant_slug_history (tenant_id, old_subdomain, new_subdomain, changed_by)
    VALUES (_tenant_id, v_old, v_clean, auth.uid());

    UPDATE public.tenant_domains
       SET subdomain = v_clean, updated_at = now()
     WHERE tenant_id = _tenant_id AND subdomain = v_old;
  ELSIF v_old IS NULL THEN
    INSERT INTO public.tenant_domains (tenant_id, subdomain, domain_status, ssl_status)
    VALUES (_tenant_id, v_clean, 'active', 'active');
  END IF;

  RETURN v_clean;
END;
$$ SET search_path = public;

REVOKE ALL ON FUNCTION public.rename_tenant_subdomain(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_tenant_subdomain(uuid, text) TO authenticated, service_role;

-- 6. Resolve subdomain → tenant (public read-only helper)
CREATE OR REPLACE FUNCTION public.resolve_subdomain(_subdomain text)
RETURNS TABLE(tenant_id uuid, redirect_to text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH active AS (
    SELECT td.tenant_id, NULL::text AS redirect_to, td.domain_status AS status
    FROM public.tenant_domains td
    WHERE td.subdomain = lower(_subdomain)
    LIMIT 1
  ),
  redirected AS (
    SELECT h.tenant_id, h.new_subdomain AS redirect_to, 'redirect'::text AS status
    FROM public.tenant_slug_history h
    WHERE h.old_subdomain = lower(_subdomain) AND h.redirect_until > now()
    ORDER BY h.changed_at DESC
    LIMIT 1
  )
  SELECT * FROM active
  UNION ALL
  SELECT * FROM redirected WHERE NOT EXISTS (SELECT 1 FROM active);
$$ SET search_path = public;

REVOKE ALL ON FUNCTION public.resolve_subdomain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_subdomain(text) TO anon, authenticated, service_role;
