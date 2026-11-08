-- Restructure to Starter Core + Addons pricing model

-- 1) Onboarding plans table: keep only Trial + Starter Core as selectable.
--    Pro / Enterprise are no longer separate plans — their features are addons.
UPDATE public.plans
SET is_active = false
WHERE name IN ('pro', 'enterprise');

-- Rebrand the 'free' plan as Starter Core with a low non-zero base price.
UPDATE public.plans
SET 
  price = 49,
  description = 'Starter Core — the minimum a single-branch restaurant needs to start selling today. Add modules during onboarding to grow.'
WHERE name = 'free';

-- 2) Landing page pricing cards: rebuild as Starter Core / Growth Bundle / Enterprise.
UPDATE public.landing_pricing_plans SET is_active = false;

INSERT INTO public.landing_pricing_plans
  (name, sort_order, monthly_price, annual_price, tagline, description,
   badge_text, is_active, is_highlighted, cta_text, features)
VALUES
  (
    'Starter Core', 1, 49, 39, 'The Essentials',
    'Everything a single-branch restaurant needs to start selling today. Add modules à la carte as you grow.',
    NULL, true, false, 'Start Free Trial',
    '["1 branch, up to 3 users","POS + Cash Drawer + Shift Control","Basic Inventory (100 SKUs) & Menu (50 items)","Daily Sales Dashboard","Manual Expense Tracking"]'::jsonb
  ),
  (
    'Growth Bundle', 2, 199, 165, 'Most Operators Pick This',
    'Starter Core plus the modules growing restaurants need: full accounting, COGS, payroll, and customer debt.',
    'Most Popular', true, true, 'Build Your Plan',
    '["Everything in Starter Core","Full Accounting (CoA, P&L, Trial Balance)","Real-time COGS & Recipe Costing","Automated Payroll & Staff Advances","Customer Debt & Loyalty","Profit Forecasting"]'::jsonb
  ),
  (
    'Enterprise', 3, NULL, NULL, 'Multi-Branch & Compliance',
    'Custom configuration for chains, franchises, and KSA-regulated operators. Includes everything plus enterprise modules.',
    NULL, true, false, 'Talk to Sales',
    '["Unlimited branches & users","ZATCA Phase 2 e-invoicing","KDS, CFD, Floor Plan & Aggregators","Online Ordering & Web Builder","Multi-currency & API Access","Dedicated success manager"]'::jsonb
  );