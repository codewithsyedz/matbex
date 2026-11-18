-- Data changes production does not have yet, repeated after the cutover data copy.
--
-- The data move copies production over tables the migrations already updated, so these statements
-- are taken from the migrations named below and run again (migrate-from-supabase, step "repairs",
-- after "fixups"). Every statement is safe to run twice. Keep migration order.
--
-- A new migration that changes existing rows must add its statements here, or be listed below with
-- the reason; src/lib/__tests__/postCopyRepairs.test.ts enforces this.
--
-- no-repair: 20261106223645_0043_accountant_inventory_and_expense_corrections.sql (text inside a function definition)
-- no-repair: 20261109000100_create_dashboard_created_buckets.sql (the storage step upserts buckets)
-- no-repair: 20261109102727_seed_standard_coa_for_new_tenants.sql (done by the fixups step)
-- no-repair: 20261109121304_seed_cash_over_short_for_new_tenants.sql (done by the fixups step)
-- no-repair: 20261110172707_consistent_customer_balance.sql (done by the fixups step)
-- no-repair: 20261116195051_subscription_vat_invoices_superadmin_mfa.sql (production has no subscription_payments)
-- no-repair: 20261117210248_entitlements_map.sql (new catalogue table, not overwritten by the copy)
-- no-repair: 20261118090243_tenant_costs_data_export_erasure.sql (the storage step keeps this bucket)

-- repairs: 20261111190452_customer_account_receivables.sql
INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, is_active, description)
SELECT t.id, '1130', 'Accounts Receivable - Customer Accounts', 'asset', true,
       'What customers owe on their tabs; separate from delivery-platform receivables'
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = t.id AND c.account_code = '1130');

-- repairs: 20261111200912_strong_global_cfd_pair_codes.sql
UPDATE public.cfd_sessions SET pair_code = public.new_cfd_pair_code() WHERE length(pair_code) < 10;

ALTER TABLE public.cfd_sessions DROP CONSTRAINT IF EXISTS cfd_sessions_pair_code_min_length;
ALTER TABLE public.cfd_sessions
  ADD CONSTRAINT cfd_sessions_pair_code_min_length CHECK (length(pair_code) >= 10);
CREATE UNIQUE INDEX IF NOT EXISTS cfd_sessions_pair_code_key ON public.cfd_sessions (pair_code);

-- repairs: 20261111212318_plans_price_list_and_trial.sql
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

-- repairs: 20261112085212_invoice_ledger_check_and_bill_header_sync.sql
SELECT public.sync_bill_header_from_expenses(pi.id)
FROM public.purchase_invoices pi
WHERE EXISTS (SELECT 1 FROM public.expenses e WHERE e.purchase_invoice_id = pi.id AND e.deleted_at IS NULL);

-- repairs: 20261112130722_primary_branch_for_branchless_businesses.sql
DO $$
DECLARE
  r record;
  v_branch uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (rs.tenant_id) rs.id, rs.name, rs.timezone
    FROM restaurants rs
    WHERE NOT EXISTS (
      SELECT 1 FROM branches b JOIN restaurants r2 ON r2.id = b.restaurant_id
      WHERE r2.tenant_id = rs.tenant_id AND b.deleted_at IS NULL)
    ORDER BY rs.tenant_id, rs.is_primary DESC NULLS LAST, rs.created_at
  LOOP
    INSERT INTO branches (restaurant_id, name, timezone, is_primary, is_active)
    VALUES (r.id, r.name, r.timezone, true, true)
    RETURNING id INTO v_branch;
    UPDATE drawers SET branch_id = v_branch WHERE restaurant_id = r.id AND branch_id IS NULL;
    UPDATE shift_templates SET branch_id = v_branch WHERE restaurant_id = r.id AND branch_id IS NULL;
  END LOOP;
END $$;

-- repairs: 20261112135750_input_vat_account_for_every_chart.sql
INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
SELECT t.id, '1180', 'Input VAT Recoverable', 'asset', 'VAT paid on purchases and expenses, recoverable from ZATCA', true
FROM tenants t
WHERE EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = t.id)
ON CONFLICT (tenant_id, account_code) DO NOTHING;

-- repairs: 20261113000057_default_menu_categories.sql
SELECT public.seed_default_menu_categories(r.id)
FROM restaurants r
WHERE NOT EXISTS (SELECT 1 FROM menu_categories c WHERE c.restaurant_id = r.id);

-- repairs: 20261114133244_card_clearing_account_for_every_chart.sql
INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
SELECT t.id, '1015', 'Card Settlements Receivable', 'asset',
       'Card sales waiting for the payment provider''s payout; cleared when the payout reaches the bank', true
FROM tenants t
WHERE EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = t.id)
ON CONFLICT (tenant_id, account_code) DO NOTHING;

-- repairs: 20261115125033_remove_menu_item_limits.sql
UPDATE public.plans
SET quota_limits = quota_limits - 'menu_items',
    updated_at = now()
WHERE quota_limits ? 'menu_items';

UPDATE public.addons
SET quota_boosts = quota_boosts - 'menu_items'
WHERE jsonb_typeof(quota_boosts) = 'object' AND quota_boosts ? 'menu_items';

-- repairs: 20261115180648_payment_gateway_configs_one_per_branch.sql
DELETE FROM public.payment_gateway_configs c
USING (
  SELECT id, row_number() OVER (
    PARTITION BY tenant_id, branch_id, gateway
    ORDER BY updated_at DESC, created_at DESC, id
  ) AS n
  FROM public.payment_gateway_configs
) d
WHERE c.id = d.id AND d.n > 1;

ALTER TABLE public.payment_gateway_configs
  DROP CONSTRAINT IF EXISTS payment_gateway_configs_tenant_id_branch_id_gateway_key;
ALTER TABLE public.payment_gateway_configs
  ADD CONSTRAINT payment_gateway_configs_tenant_id_branch_id_gateway_key
  UNIQUE NULLS NOT DISTINCT (tenant_id, branch_id, gateway);

-- repairs: 20261115201212_move_stripe_customers_to_moyasar.sql
UPDATE public.tenants
   SET billing_provider = 'moyasar', updated_at = now()
 WHERE billing_provider = 'stripe'
   AND stripe_customer_id IS NOT NULL
   AND current_period_end IS NOT NULL;

-- repairs: 20261115204525_smoke_grill_moyasar_billing.sql
UPDATE public.tenants
   SET billing_provider = 'moyasar',
       current_period_end = '2026-12-05 23:59:59+03',
       updated_at = now()
 WHERE id = 'fe1a4d9e-1595-43ba-a47a-37575a9a55b9'
   AND billing_provider = 'stripe';

-- repairs: 20261115205422_moyasar_paid_accounts_active.sql
UPDATE public.tenants
   SET status = 'active', updated_at = now()
 WHERE billing_provider = 'moyasar'
   AND status IN ('canceled', 'past_due')
   AND current_period_end > now();

-- repairs: 20261116130106_aggregators_enterprise_only.sql
UPDATE public.feature_flags
   SET enabled = true, min_plan = 'enterprise', updated_at = now()
 WHERE key = 'aggregators_enabled';

INSERT INTO public.feature_flags (key, enabled, min_plan, description)
SELECT 'aggregators_enabled', true, 'enterprise', 'Delivery Aggregators (Deliverect): Enterprise plan'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE key = 'aggregators_enabled');

UPDATE public.plans
   SET default_feature_flags = COALESCE(default_feature_flags, '{}'::jsonb)
         || jsonb_build_object('aggregators', name = 'enterprise'),
       updated_at = now()
 WHERE name IN ('trial', 'starter', 'pro', 'enterprise');

-- repairs: 20261116183445_merge_duplicate_azizia_supplier.sql
DO $$
DECLARE
  k constant uuid := 'd5930060-816f-48d9-8127-5883c5444315';
  d constant uuid := 'd4463885-ade3-47cc-bbdf-25cc5b57e49c';
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = k) OR NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = d) THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['purchase_invoices', 'expenses', 'purchases', 'supplier_payments', 'inventory_items',
                           'inventory_batches', 'project_commitments', 'project_transactions', 'supplier_ap_account_audit'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I SET supplier_id = $1 WHERE supplier_id = $2', t) USING k, d;
    END IF;
  END LOOP;
  DELETE FROM public.suppliers WHERE id = d;
END $$;

-- repairs: 20261117211231_higher_plans_include_starter_features.sql
UPDATE public.plans p
   SET default_feature_flags = s.extra || coalesce(p.default_feature_flags, '{}'::jsonb),
       updated_at = now()
  FROM (
    SELECT coalesce(jsonb_object_agg(k.key, true), '{}'::jsonb) AS extra
      FROM public.plans sp, jsonb_each(sp.default_feature_flags) k
     WHERE sp.name = 'starter' AND k.value = 'true'::jsonb
  ) s
 WHERE p.name IN ('trial', 'pro', 'enterprise');
