
-- 1. New columns on addons for onboarding grouping
ALTER TABLE public.addons
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS recommended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS short_pitch text;

CREATE INDEX IF NOT EXISTS idx_addons_category ON public.addons(category);

-- 2. Re-baseline the Starter Core (existing "free" plan)
UPDATE public.plans
SET
  description = 'Starter Core — everything a single-branch restaurant needs to start selling today. Add modules during onboarding to grow.',
  default_feature_flags = jsonb_build_object(
    'pos', true,
    'cash_drawer', true,
    'shifts', true,
    'menu', true,
    'inventory_basic', true,
    'daily_dashboard', true,
    'daily_profit', true,
    -- explicit OFF — sold as addons
    'cogs', false,
    'accounting', false,
    'advance_pay', false,
    'payroll', false,
    'web_builder', false,
    'public_subdomain', false,
    'custom_domain', false,
    'email_reports', false,
    'advanced_reports', false,
    'multi_location', false,
    'api_access', false,
    'chat', false,
    'online_ordering', false,
    'loyalty', false,
    'customer_debt', false,
    'aggregators', false,
    'whatsapp', false,
    'zatca_phase2', false,
    'kds', false,
    'cfd', false,
    'floor_plan', false,
    'multi_currency', false
  ),
  quota_limits = jsonb_build_object(
    'owner', 1,
    'manager', 1,
    'cashier', 2,
    'users', 3,
    'branches', 1,
    'menu_items', 50,
    'inventory_items', 100,
    'image_uploads', 50,
    'device_seats_per_branch', 1,
    'email_reminders', 100
  )
WHERE name = 'free';

-- 3. Seed addon catalog (idempotent via slug)
INSERT INTO public.addons (name, slug, description, short_pitch, category, price, currency, billing_type, included_features, quota_boosts, sort_order, recommended, is_active)
VALUES
  -- Scale & Team
  ('Extra Branch', 'extra-branch', 'Add another physical branch with its own staff and inventory.', 'Open a new location', 'scale_team', 25, 'SAR', 'recurring', '["multi_location"]'::jsonb, '{"branches":1}'::jsonb, 10, false, true),
  ('Team Seats Pack (+5)', 'team-seats-5', 'Add 5 extra staff seats (mix of managers and cashiers).', 'Grow your team', 'scale_team', 15, 'SAR', 'recurring', '[]'::jsonb, '{"users":5,"cashier":5}'::jsonb, 11, false, true),
  ('Extra Device Seats (+3)', 'device-seats-3', 'Run Matbex on 3 more POS / KDS / CFD devices per branch.', 'More devices per branch', 'scale_team', 12, 'SAR', 'recurring', '[]'::jsonb, '{"device_seats_per_branch":3}'::jsonb, 12, false, true),

  -- Financial Intelligence
  ('Full Accounting', 'accounting-suite', 'Chart of Accounts, journal entries, P&L, trial balance, monthly close.', 'Real accounting, not spreadsheets', 'financial', 29, 'SAR', 'recurring', '["accounting","advanced_reports","email_reports"]'::jsonb, '{}'::jsonb, 20, true, true),
  ('COGS & Stocktake', 'cogs-stocktake', 'Automated cost of goods sold, weekly/monthly stocktake wizard, recipe costing.', 'Know your true food cost', 'financial', 19, 'SAR', 'recurring', '["cogs"]'::jsonb, '{}'::jsonb, 21, true, true),
  ('Payroll & Advances', 'payroll-advances', 'Staff payroll, salary advances, end-of-service, payslip emails.', 'Pay your team properly', 'financial', 15, 'SAR', 'recurring', '["payroll","advance_pay"]'::jsonb, '{}'::jsonb, 22, false, true),
  ('Profit Forecasting', 'profit-forecasting', 'Daily profit emails, monthly forecasts, fiscal cycle reporting.', 'See where the month is heading', 'financial', 9, 'SAR', 'recurring', '["daily_profit","advanced_reports","email_reports"]'::jsonb, '{}'::jsonb, 23, false, true),

  -- Customer & Growth
  ('Online Ordering', 'online-ordering', 'Public order page, real-time order manager, customer notifications.', 'Sell beyond the counter', 'growth', 25, 'SAR', 'recurring', '["online_ordering","public_subdomain"]'::jsonb, '{}'::jsonb, 30, true, true),
  ('Web Builder & Custom Domain', 'web-builder', 'Branded restaurant site, live menu, custom domain, SEO ready.', 'Your own restaurant website', 'growth', 19, 'SAR', 'recurring', '["web_builder","public_subdomain","custom_domain"]'::jsonb, '{}'::jsonb, 31, false, true),
  ('Customer Debt & Tabs', 'customer-debt', 'House accounts, tabs, settlements and reminders.', 'Track who owes what', 'growth', 9, 'SAR', 'recurring', '["customer_debt"]'::jsonb, '{}'::jsonb, 32, false, true),
  ('Loyalty & Rewards', 'loyalty', 'Points, tiers, customer rewards engine.', 'Bring customers back', 'growth', 12, 'SAR', 'recurring', '["loyalty"]'::jsonb, '{}'::jsonb, 33, false, true),
  ('Aggregator Integrations', 'aggregators', 'HungerStation, Jahez, Toyou, Talabat reconciliation.', 'One inbox for all delivery apps', 'growth', 19, 'SAR', 'recurring', '["aggregators"]'::jsonb, '{}'::jsonb, 34, false, true),
  ('WhatsApp Notifications', 'whatsapp', 'Order receipts and marketing via WhatsApp Business.', 'Talk to customers where they are', 'growth', 9, 'SAR', 'recurring', '["whatsapp"]'::jsonb, '{"email_reminders":1000}'::jsonb, 35, false, true),

  -- Compliance & Advanced
  ('ZATCA Phase 2', 'zatca-phase2', 'E-invoicing, device certification, real-time clearance and reporting.', 'KSA tax-compliant invoicing', 'compliance', 25, 'SAR', 'recurring', '["zatca_phase2"]'::jsonb, '{}'::jsonb, 40, true, true),
  ('Multi-Currency', 'multi-currency', 'Charge and report in multiple currencies with daily FX.', 'For tourist & border locations', 'compliance', 9, 'SAR', 'recurring', '["multi_currency"]'::jsonb, '{}'::jsonb, 41, false, true),
  ('Kitchen Display (KDS)', 'kds', 'Dedicated kitchen screens, station routing, prep timers.', 'Tickets straight to the kitchen', 'compliance', 15, 'SAR', 'recurring', '["kds"]'::jsonb, '{}'::jsonb, 42, false, true),
  ('Customer-Facing Display', 'cfd', 'Second screen for customer order confirmation and promos.', 'Counter trust + upsell', 'compliance', 9, 'SAR', 'recurring', '["cfd"]'::jsonb, '{}'::jsonb, 43, false, true),
  ('Floor Plan & Tables', 'floor-plan', 'Visual floor plan, table assignment, dine-in management.', 'Manage dine-in like a pro', 'compliance', 12, 'SAR', 'recurring', '["floor_plan"]'::jsonb, '{}'::jsonb, 44, false, true),
  ('Public API Access', 'api-access', 'REST API + webhooks for custom integrations.', 'Plug Matbex into anything', 'compliance', 19, 'SAR', 'recurring', '["api_access"]'::jsonb, '{}'::jsonb, 45, false, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  short_pitch = EXCLUDED.short_pitch,
  category = EXCLUDED.category,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  billing_type = EXCLUDED.billing_type,
  included_features = EXCLUDED.included_features,
  quota_boosts = EXCLUDED.quota_boosts,
  sort_order = EXCLUDED.sort_order,
  recommended = EXCLUDED.recommended,
  is_active = EXCLUDED.is_active;
