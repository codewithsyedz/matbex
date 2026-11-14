-- plans_price_list_and_trial
--
-- One price list everywhere, in SAR per branch per month excluding VAT, the one the site
-- already publishes (src/data/pricing.ts): Starter Core 149, Growth 349 (plan name 'pro'),
-- Enterprise 699; yearly = 10 months. The repo's migrations still had the old USD prices
-- (free 18, pro 49, enterprise 199) and no 'starter' or 'trial' rows, so fresh databases
-- differed from production and signup showed "Starter Core 68" (18 USD) and saved 'free'.
--
-- Trial: 14 days, no card, Growth features, 1 branch (start-free-trial). The legacy 'free'
-- plan (18 USD) is closed to new signups; businesses on it keep it.
--
-- Existing rows keep their own feature flags and quotas (an admin may have tuned them); keys
-- they lack are added from production's values of 2026-11-12. Missing rows are created.
INSERT INTO public.plans (name, price, billing_interval, is_active, description, default_feature_flags, quota_limits)
VALUES
  ('trial', 0, 'monthly', true, '14-day free trial, no card: Growth features, 1 branch. Choose a plan before it ends.', '{"accounting": true, "advance_pay": true, "advanced_reports": true, "api_access": false, "chat": false, "cogs": true, "custom_domain": false, "daily_profit": true, "email_reports": true, "inventory": true, "menu": true, "multi_location": false, "payroll": true, "public_subdomain": true, "shifts": true, "web_builder": true}'::jsonb, '{"branches": 1, "cashier": 3, "email_reminders": 200, "image_uploads": 100, "manager": 1, "menu_items": 50, "owner": 1, "users": 3}'::jsonb),
  ('starter', 149, 'monthly', true, 'Starter Core — 149 SAR per branch/month (1,490 SAR/year, 2 months free). POS, menu, shifts, cash drawer, daily dashboard and basic stock. ZATCA, full accounting, payroll and multi-branch not included.', '{"accounting": false, "advance_pay": false, "advanced_reports": false, "aggregators": false, "api_access": false, "cash_drawer": true, "cfd": false, "chat": false, "cogs": false, "custom_domain": false, "customer_debt": false, "daily_dashboard": true, "daily_profit": true, "email_reports": false, "floor_plan": false, "inventory": false, "inventory_basic": true, "kds": false, "loyalty": false, "menu": true, "multi_currency": false, "multi_location": false, "online_ordering": false, "payroll": false, "pos": true, "public_subdomain": true, "shifts": true, "web_builder": false, "whatsapp": false, "zatca_phase2": false}'::jsonb, '{"branches": 1, "cashier": 2, "device_seats_per_branch": 1, "email_reminders": 100, "image_uploads": 50, "inventory_items": 100, "manager": 1, "menu_items": 75, "owner": 1, "users": 3}'::jsonb),
  ('pro', 349, 'monthly', true, 'Growth Bundle — 349 SAR per branch/month (3,490 SAR/year, 2 months free). Adds ZATCA, accounting, payroll and COGS.', '{"accounting": true, "advance_pay": true, "advanced_reports": true, "api_access": false, "chat": false, "cogs": true, "custom_domain": true, "daily_profit": true, "email_reports": true, "inventory": true, "menu": true, "multi_location": false, "payroll": true, "public_subdomain": true, "shifts": true, "web_builder": true, "zatca_phase2": true}'::jsonb, '{"cashier": 5, "email_reminders": 1000, "image_uploads": 300, "manager": 2, "menu_items": 100, "owner": 2, "users": 5}'::jsonb),
  ('enterprise', 699, 'monthly', true, 'Enterprise — 699 SAR per branch/month (6,990 SAR/year). Multi-branch chains, API access; set up with sales.', '{"accounting": true, "advance_pay": true, "advanced_reports": true, "api_access": true, "chat": false, "cogs": true, "custom_domain": true, "daily_profit": true, "email_reports": true, "inventory": true, "menu": true, "multi_location": true, "payroll": true, "public_subdomain": true, "shifts": true, "web_builder": true, "zatca_phase2": true}'::jsonb, '{"cashier": 8, "device_seats_per_branch": 10, "email_reminders": 5000, "image_uploads": 5000, "manager": 5, "menu_items": 200, "owner": 4, "users": 20}'::jsonb)
ON CONFLICT (name) DO UPDATE SET
  price = EXCLUDED.price,
  is_active = EXCLUDED.is_active,
  description = EXCLUDED.description,
  default_feature_flags = EXCLUDED.default_feature_flags || COALESCE(public.plans.default_feature_flags, '{}'::jsonb),
  quota_limits = EXCLUDED.quota_limits || COALESCE(public.plans.quota_limits, '{}'::jsonb),
  updated_at = now();

UPDATE public.plans
SET is_active = false,
    description = 'Legacy Starter (18 USD/month): closed to new signups; existing businesses keep it.',
    updated_at = now()
WHERE name = 'free';

-- Trial businesses: one active branch (the trial plan's quota_limits.branches, default 1).
-- multi_location is only an admin switch, so the cap is enforced here, for every way a branch
-- is added or restored. Paid plans are not limited here.
CREATE OR REPLACE FUNCTION public.enforce_trial_branch_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_status text;
  v_limit integer;
  v_count integer;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL THEN
    RETURN NEW;  -- not a restore
  END IF;
  SELECT t.id, t.status INTO v_tenant, v_status
  FROM restaurants r JOIN tenants t ON t.id = r.tenant_id
  WHERE r.id = NEW.restaurant_id;
  IF v_status IS DISTINCT FROM 'trial' THEN
    RETURN NEW;
  END IF;
  SELECT (quota_limits->>'branches')::integer INTO v_limit FROM plans WHERE name = 'trial';
  v_limit := COALESCE(v_limit, 1);
  SELECT count(*) INTO v_count
  FROM branches b JOIN restaurants r ON r.id = b.restaurant_id
  WHERE r.tenant_id = v_tenant AND b.deleted_at IS NULL AND b.id <> NEW.id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'TRIAL_BRANCH_LIMIT: the free trial includes % branch; choose a plan to add more', v_limit
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_trial_branch_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_trial_branch_limit ON public.branches;
CREATE TRIGGER trg_enforce_trial_branch_limit
  BEFORE INSERT OR UPDATE OF deleted_at ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_branch_limit();
