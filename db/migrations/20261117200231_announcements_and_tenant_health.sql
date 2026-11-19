-- In-app announcements (SuperAdmin → Announcements) and the per-business health signals behind
-- SuperAdmin → Customer Health.

-- ---------------------------------------------------------------------------- announcements
CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  body text CHECK (body IS NULL OR length(body) <= 600),
  -- info: news; feature: something new; maintenance: planned work; warning: something to act on;
  -- critical: an outage or urgent issue (not dismissible in the banner)
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'feature', 'maintenance', 'warning', 'critical')),
  -- who sees it: everyone, businesses on trial, paying businesses, or the plans listed
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'trial', 'paying', 'plans')),
  plans text[],
  link_url text CHECK (link_url IS NULL OR link_url ~ '^(https://|/)'),
  link_label text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  published boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (audience <> 'plans' OR coalesce(array_length(plans, 1), 0) > 0)
);
CREATE INDEX IF NOT EXISTS platform_announcements_live_idx ON public.platform_announcements (starts_at, ends_at) WHERE published;

ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "announcements_superadmin_all" ON public.platform_announcements;
CREATE POLICY "announcements_superadmin_all" ON public.platform_announcements
  FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_announcements TO authenticated;
GRANT ALL ON public.platform_announcements TO service_role;

DROP TRIGGER IF EXISTS trg_platform_announcements_updated_at ON public.platform_announcements;
CREATE TRIGGER trg_platform_announcements_updated_at BEFORE UPDATE ON public.platform_announcements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES public.platform_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);
ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "announcement_dismissals_own" ON public.announcement_dismissals;
CREATE POLICY "announcement_dismissals_own" ON public.announcement_dismissals
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "announcement_dismissals_superadmin_read" ON public.announcement_dismissals;
CREATE POLICY "announcement_dismissals_superadmin_read" ON public.announcement_dismissals
  FOR SELECT TO authenticated USING (public.is_superadmin(auth.uid()));
GRANT SELECT, INSERT, DELETE ON public.announcement_dismissals TO authenticated;
GRANT ALL ON public.announcement_dismissals TO service_role;

-- The announcements the signed-in user should see now: published, in their time window, meant
-- for their business (by trial / paying / plan), and not dismissed by them. Critical ones are
-- shown even when dismissed earlier.
CREATE OR REPLACE FUNCTION public.active_announcements()
RETURNS TABLE (id uuid, title text, body text, severity text, link_url text, link_label text, starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT t.status, p.name AS plan
      FROM public.profiles pr
      JOIN public.tenants t ON t.id = pr.tenant_id
      LEFT JOIN public.plans p ON p.id = t.plan_id
     WHERE pr.id = auth.uid()
  )
  SELECT a.id, a.title, a.body, a.severity, a.link_url, a.link_label, a.starts_at, a.ends_at
    FROM public.platform_announcements a
    LEFT JOIN me ON true
   WHERE auth.uid() IS NOT NULL
     AND a.published
     AND a.starts_at <= now()
     AND (a.ends_at IS NULL OR a.ends_at > now())
     AND (
       a.audience = 'all'
       OR (a.audience = 'trial' AND me.status = 'trial')
       OR (a.audience = 'paying' AND me.status IN ('active', 'past_due') AND coalesce(me.plan, '') NOT IN ('trial', 'free'))
       OR (a.audience = 'plans' AND me.plan = ANY (a.plans))
     )
     AND (a.severity = 'critical' OR NOT EXISTS (
       SELECT 1 FROM public.announcement_dismissals d WHERE d.announcement_id = a.id AND d.user_id = auth.uid()))
   ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'maintenance' THEN 2 WHEN 'feature' THEN 3 ELSE 4 END,
            a.starts_at DESC
   LIMIT 5;
$function$;
REVOKE ALL ON FUNCTION public.active_announcements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.active_announcements() TO authenticated;

-- ---------------------------------------------------------------------------- customer health
-- Signals per business for the SuperAdmin health score (scored in the app: src/lib/admin/healthScore.ts).
-- Sales exclude voids and void entries; "last login" is the latest sign-in of any user of the business.
CREATE OR REPLACE FUNCTION public.admin_tenant_health()
RETURNS TABLE (
  tenant_id uuid, name text, status text, plan text, created_at timestamptz, trial_ends_at timestamptz,
  current_period_end timestamptz, billing_provider text,
  users int, last_login_at timestamptz,
  sales_7d int, sales_prev_28d int, revenue_30d numeric, last_sale_at timestamptz,
  setup_done int, setup_total int
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'SuperAdmin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH r AS (
    SELECT id, tenant_id FROM public.restaurants
  ), s AS (
    SELECT r.tenant_id,
           count(*) FILTER (WHERE st.created_at > now() - interval '7 days')::int AS s7,
           count(*) FILTER (WHERE st.created_at <= now() - interval '7 days' AND st.created_at > now() - interval '35 days')::int AS s28,
           coalesce(sum(st.total) FILTER (WHERE st.created_at > now() - interval '30 days'), 0) AS rev30,
           max(st.created_at) AS last_sale
      FROM public.sales_transactions st
      JOIN r ON r.id = st.restaurant_id
     WHERE st.voided_at IS NULL AND st.voids_transaction_id IS NULL
       AND st.created_at > now() - interval '120 days'
     GROUP BY r.tenant_id
  ), last_sale_any AS (
    SELECT r.tenant_id, max(st.created_at) AS at
      FROM public.sales_transactions st JOIN r ON r.id = st.restaurant_id
     GROUP BY r.tenant_id
  ), u AS (
    SELECT utr.tenant_id, count(DISTINCT utr.user_id)::int AS n, max(au.last_sign_in_at) AS last_login
      FROM public.user_tenant_roles utr
      LEFT JOIN auth.users au ON au.id = utr.user_id
     GROUP BY utr.tenant_id
  ), setup AS (
    SELECT t.id AS tenant_id,
      (EXISTS (SELECT 1 FROM public.menu_items m JOIN r ON r.id = m.restaurant_id WHERE r.tenant_id = t.id))::int
      + (EXISTS (SELECT 1 FROM public.inventory_items i JOIN r ON r.id = i.restaurant_id WHERE r.tenant_id = t.id))::int
      + ((SELECT count(*) FROM public.user_tenant_roles x WHERE x.tenant_id = t.id) > 1)::int
      + (EXISTS (SELECT 1 FROM public.zatca_settings z WHERE z.tenant_id = t.id AND z.vat_registration_number IS NOT NULL))::int
      + (EXISTS (SELECT 1 FROM public.payment_gateway_configs g WHERE g.tenant_id = t.id AND g.enabled))::int
      + (EXISTS (SELECT 1 FROM last_sale_any l WHERE l.tenant_id = t.id AND l.at IS NOT NULL))::int AS done
      FROM public.tenants t
  )
  SELECT t.id, t.name, t.status, p.name, t.created_at, t.trial_ends_at, t.current_period_end, t.billing_provider,
         coalesce(u.n, 0), u.last_login,
         coalesce(s.s7, 0), coalesce(s.s28, 0), coalesce(s.rev30, 0), coalesce(s.last_sale, la.at),
         setup.done, 6
    FROM public.tenants t
    LEFT JOIN public.plans p ON p.id = t.plan_id
    LEFT JOIN s ON s.tenant_id = t.id
    LEFT JOIN last_sale_any la ON la.tenant_id = t.id
    LEFT JOIN u ON u.tenant_id = t.id
    LEFT JOIN setup ON setup.tenant_id = t.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_tenant_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tenant_health() TO authenticated;
