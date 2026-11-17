-- One entitlement map: what a business can use, and why.
--
-- Before: the browser merged plan defaults, per-business overrides and add-ons itself; rollout
-- flags with a minimum plan were a separate list with their own keys; the server checked one
-- flag by hand; and five admin screens each kept their own (different, incomplete) feature list.
-- Now:
--   platform_features            the catalogue: every feature key with its label and group
--   plan_rank(plan)              plan order for minimum-plan flags (Starter was missing)
--   tenant_entitlements(tenant)  features (with the reason each is on/off) + quotas, computed
--                                once, used by the app (AuthCore) and the server (entitlements.ts)
--   tenant_has_feature(tenant, key)
-- Precedence for a feature: a SuperAdmin override (tenant_features) wins; otherwise on when the
-- plan includes it or an active add-on unlocks it. Rollout flags (feature_flags) keep their own
-- keys and rules; they are returned in the same map (a feature with the same key wins) and alone. Quotas: plan quota_limits + active add-on
-- quota_boosts.

CREATE TABLE IF NOT EXISTS public.platform_features (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  label text NOT NULL,
  description text,
  category text NOT NULL,
  sort_order int NOT NULL DEFAULT 100
);
ALTER TABLE public.platform_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_features_read" ON public.platform_features;
CREATE POLICY "platform_features_read" ON public.platform_features FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "platform_features_superadmin_write" ON public.platform_features;
CREATE POLICY "platform_features_superadmin_write" ON public.platform_features FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid())) WITH CHECK (public.is_superadmin(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_features TO authenticated;
GRANT ALL ON public.platform_features TO service_role;

INSERT INTO public.platform_features (key, label, description, category, sort_order) VALUES
  ('pos',              'Point of sale',            'Ring up sales on the POS',                                   'Point of sale', 10),
  ('shifts',           'Shifts',                   'Cashier shifts and shift reports',                           'Point of sale', 11),
  ('cash_drawer',      'Cash drawer',              'Drawer counts, cash in and out',                             'Point of sale', 12),
  ('kds',              'Kitchen display',          'Orders on a kitchen screen',                                 'Point of sale', 13),
  ('cfd',              'Customer display',         'Order and total shown to the customer',                      'Point of sale', 14),
  ('floor_plan',       'Floor plan and tables',    'Tables, dine-in orders and the floor plan',                  'Point of sale', 15),
  ('customer_debt',    'Customer debt and tabs',   'Sell on credit, settlement invoices and payments',           'Point of sale', 16),
  ('loyalty',          'Loyalty and rewards',      'Points and rewards for customers',                           'Point of sale', 17),
  ('menu',             'Menu',                     'Menu items, categories and prices',                          'Menu and stock', 20),
  ('inventory_basic',  'Basic stock',              'Stock items and simple counts',                              'Menu and stock', 21),
  ('inventory',        'Inventory',                'Full stock tracking, purchases and suppliers',               'Menu and stock', 22),
  ('cogs',             'COGS and stocktake',       'Cost of goods sold, recipes and stocktakes',                 'Menu and stock', 23),
  ('daily_dashboard',  'Daily dashboard',          'Today''s sales, costs and profit at a glance',               'Finance', 30),
  ('daily_profit',     'Daily profit',             'Daily profit calculations and reports',                      'Finance', 31),
  ('accounting',       'Accounting',               'Chart of accounts, journals, VAT and period close',          'Finance', 32),
  ('advanced_reports', 'Advanced reports',         'Detailed financial and sales reports',                       'Finance', 33),
  ('email_reports',    'Email reports',            'Scheduled reports by email',                                 'Finance', 34),
  ('zatca_phase2',     'ZATCA Phase 2',            'E-invoice clearance and reporting with ZATCA',               'Finance', 35),
  ('multi_currency',   'Multiple currencies',      'Prices and reports in more than one currency',               'Finance', 36),
  ('payroll',          'Payroll',                  'Salaries, payroll runs and labour cost',                     'Team', 40),
  ('advance_pay',      'Salary advances',          'Staff advances and deductions',                              'Team', 41),
  ('chat',             'Team chat',                'Chat between staff',                                         'Team', 42),
  ('multi_location',   'Multiple branches',        'More than one branch under one business',                    'Team', 43),
  ('online_ordering',  'Online ordering',          'Customers order and pay online',                             'Online and growth', 50),
  ('aggregators',      'Delivery apps',            'Orders from delivery apps (Deliverect)',                     'Online and growth', 51),
  ('whatsapp',         'WhatsApp',                 'Order updates and summaries on WhatsApp',                    'Online and growth', 52),
  ('web_builder',      'Website builder',          'Build the restaurant''s website',                            'Online and growth', 53),
  ('public_subdomain', 'Matbex web address',       'A your-name.matbex.com address',                             'Online and growth', 54),
  ('custom_domain',    'Custom domain',            'The website on the restaurant''s own domain',                'Online and growth', 55),
  ('api_access',       'API access',               'Connect other systems through the Matbex API',               'Online and growth', 56)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
  category = EXCLUDED.category, sort_order = EXCLUDED.sort_order;

-- Plan order for minimum-plan rules. Starter sits between Free and Growth (pro).
CREATE OR REPLACE FUNCTION public.plan_rank(_plan text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE lower(coalesce(_plan, ''))
    WHEN 'trial' THEN 0 WHEN 'free' THEN 1 WHEN 'starter' THEN 2 WHEN 'pro' THEN 3 WHEN 'enterprise' THEN 4
    ELSE -1 END;
$function$;
GRANT EXECUTE ON FUNCTION public.plan_rank(text) TO authenticated, service_role;

-- Same signature and rules as before, with Starter ranked (it failed every minimum-plan flag).
CREATE OR REPLACE FUNCTION public.get_feature_flags_for_tenant(_tenant_id uuid)
RETURNS TABLE(flag_key text, is_enabled boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT public.plan_rank(p.name) AS rank
      FROM public.tenants tn LEFT JOIN public.plans p ON p.id = tn.plan_id
     WHERE tn.id = _tenant_id
  )
  SELECT ff.key,
    CASE
      WHEN _tenant_id = ANY (COALESCE(ff.disabled_tenant_ids, ARRAY[]::uuid[])) THEN false
      WHEN _tenant_id = ANY (COALESCE(ff.rollout_tenant_ids, ARRAY[]::uuid[])) THEN true
      WHEN ff.enabled AND (ff.min_plan IS NULL OR COALESCE((SELECT rank FROM t), -1) >= greatest(public.plan_rank(ff.min_plan), 0)) THEN true
      ELSE false
    END
  FROM public.feature_flags ff
  WHERE public.is_superadmin(auth.uid())
     OR EXISTS (SELECT 1 FROM public.user_tenant_roles utr WHERE utr.user_id = auth.uid() AND utr.tenant_id = _tenant_id);
$function$;

CREATE OR REPLACE FUNCTION public.tenant_entitlements(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan text;
  v_status text;
  v_rank int;
  v_plan_flags jsonb;
  v_plan_quotas jsonb;
  v_features jsonb;
  v_flags jsonb;
  v_quotas jsonb;
BEGIN
  -- Server functions call this with the service role (no user); users only for their business.
  IF auth.uid() IS NOT NULL AND NOT public.is_superadmin(auth.uid())
     AND NOT EXISTS (SELECT 1 FROM public.user_tenant_roles r WHERE r.user_id = auth.uid() AND r.tenant_id = _tenant_id) THEN
    RAISE EXCEPTION 'Not a member of this business' USING ERRCODE = '42501';
  END IF;

  SELECT p.name, t.status, coalesce(p.default_feature_flags, '{}'::jsonb), coalesce(p.quota_limits, '{}'::jsonb)
    INTO v_plan, v_status, v_plan_flags, v_plan_quotas
    FROM public.tenants t LEFT JOIN public.plans p ON p.id = t.plan_id
   WHERE t.id = _tenant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v_plan_flags) <> 'object' THEN v_plan_flags := '{}'::jsonb; END IF;
  IF jsonb_typeof(v_plan_quotas) <> 'object' THEN v_plan_quotas := '{}'::jsonb; END IF;
  v_rank := public.plan_rank(v_plan);

  WITH addons AS (
    SELECT a.name, coalesce(a.included_features, '[]'::jsonb) AS feats, coalesce(a.quota_boosts, '{}'::jsonb) AS boosts
      FROM public.tenant_addons ta JOIN public.addons a ON a.id = ta.addon_id
     WHERE ta.tenant_id = _tenant_id AND ta.status::text = 'active' AND (ta.expires_at IS NULL OR ta.expires_at > now())
  ), addon_feats AS (
    SELECT f.key, array_agg(DISTINCT ad.name) AS names
      FROM addons ad, jsonb_array_elements_text(CASE WHEN jsonb_typeof(ad.feats) = 'array' THEN ad.feats ELSE '[]'::jsonb END) AS f(key)
     GROUP BY f.key
  ), overrides AS (
    SELECT feature_key AS key, enabled FROM public.tenant_features WHERE tenant_id = _tenant_id
  ), keys AS (
    SELECT key FROM public.platform_features
    UNION SELECT jsonb_object_keys(v_plan_flags)
    UNION SELECT key FROM addon_feats
    UNION SELECT key FROM overrides
  )
  SELECT coalesce(jsonb_object_agg(k.key, jsonb_build_object(
           'enabled', CASE WHEN o.key IS NOT NULL THEN o.enabled
                           ELSE coalesce((v_plan_flags ->> k.key)::boolean, false) OR af.key IS NOT NULL END,
           'source',  CASE WHEN o.key IS NOT NULL THEN 'override'
                           WHEN coalesce((v_plan_flags ->> k.key)::boolean, false) THEN 'plan'
                           WHEN af.key IS NOT NULL THEN 'addon'
                           ELSE 'not_included' END,
           'addons',  coalesce(to_jsonb(af.names), '[]'::jsonb)
         )), '{}'::jsonb)
    INTO v_features
    FROM keys k
    LEFT JOIN addon_feats af ON af.key = k.key
    LEFT JOIN overrides o ON o.key = k.key;

  -- Rollout flags (their own keys): per-business lists first, then on + minimum plan.
  SELECT coalesce(jsonb_object_agg(ff.key, jsonb_build_object(
           'enabled', CASE
               WHEN _tenant_id = ANY (coalesce(ff.disabled_tenant_ids, ARRAY[]::uuid[])) THEN false
               WHEN _tenant_id = ANY (coalesce(ff.rollout_tenant_ids, ARRAY[]::uuid[])) THEN true
               ELSE ff.enabled AND (ff.min_plan IS NULL OR v_rank >= greatest(public.plan_rank(ff.min_plan), 0)) END,
           'source', CASE
               WHEN _tenant_id = ANY (coalesce(ff.disabled_tenant_ids, ARRAY[]::uuid[])) THEN 'flag_off_for_business'
               WHEN _tenant_id = ANY (coalesce(ff.rollout_tenant_ids, ARRAY[]::uuid[])) THEN 'flag_on_for_business'
               WHEN NOT ff.enabled THEN 'flag_off'
               WHEN ff.min_plan IS NOT NULL AND v_rank < greatest(public.plan_rank(ff.min_plan), 0) THEN 'flag_needs_' || lower(ff.min_plan)
               ELSE 'flag_on' END,
           'addons', '[]'::jsonb
         )), '{}'::jsonb)
    INTO v_flags
    FROM public.feature_flags ff;

  -- Quotas: the plan's limits plus every active add-on's boosts.
  WITH addons AS (
    SELECT coalesce(a.quota_boosts, '{}'::jsonb) AS boosts
      FROM public.tenant_addons ta JOIN public.addons a ON a.id = ta.addon_id
     WHERE ta.tenant_id = _tenant_id AND ta.status::text = 'active' AND (ta.expires_at IS NULL OR ta.expires_at > now())
  ), boosts AS (
    SELECT b.key, sum((b.value)::numeric) AS extra
      FROM addons, jsonb_each_text(CASE WHEN jsonb_typeof(addons.boosts) = 'object' THEN addons.boosts ELSE '{}'::jsonb END) AS b(key, value)
     WHERE b.value ~ '^-?[0-9]+(\.[0-9]+)?$'
     GROUP BY b.key
  ), keys AS (
    SELECT jsonb_object_keys(v_plan_quotas) AS key UNION SELECT key FROM boosts
  )
  SELECT coalesce(jsonb_object_agg(k.key,
           CASE WHEN (v_plan_quotas ->> k.key) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_plan_quotas ->> k.key)::numeric ELSE 0 END + coalesce(b.extra, 0)
         ), '{}'::jsonb)
    INTO v_quotas
    FROM keys k LEFT JOIN boosts b ON b.key = k.key;

  RETURN jsonb_build_object(
    'tenant_id', _tenant_id, 'plan', v_plan, 'status', v_status,
    -- Rollout flags join the feature map, but never replace a catalogue/plan feature with the
    -- same key (e.g. a "kds" rollout flag); they are also listed on their own.
    'features', v_flags || v_features,
    'flags', v_flags,
    'quotas', v_quotas
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.tenant_entitlements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_entitlements(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tenant_has_feature(_tenant_id uuid, _key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((public.tenant_entitlements(_tenant_id) -> 'features' -> _key ->> 'enabled')::boolean, false);
$function$;
REVOKE ALL ON FUNCTION public.tenant_has_feature(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_has_feature(uuid, text) TO authenticated, service_role;
