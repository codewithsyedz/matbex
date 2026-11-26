-- Add all module feature flags to plans

-- Free plan: basic features only
UPDATE public.plans 
SET default_feature_flags = jsonb_build_object(
  'daily_profit', true,
  'accounting', false,
  'inventory', false,
  'payroll', false,
  'chat', false,
  'cogs', false,
  'menu', false,
  'advance_pay', false,
  'api_access', false,
  'multi_location', false,
  'email_reports', false,
  'advanced_reports', false
)
WHERE name = 'free';

-- Pro plan: most features enabled
UPDATE public.plans 
SET default_feature_flags = jsonb_build_object(
  'daily_profit', true,
  'accounting', true,
  'inventory', true,
  'payroll', true,
  'chat', true,
  'cogs', true,
  'menu', true,
  'advance_pay', true,
  'api_access', false,
  'multi_location', false,
  'email_reports', true,
  'advanced_reports', true
)
WHERE name = 'pro';

-- Enterprise plan: all features enabled
UPDATE public.plans 
SET default_feature_flags = jsonb_build_object(
  'daily_profit', true,
  'accounting', true,
  'inventory', true,
  'payroll', true,
  'chat', true,
  'cogs', true,
  'menu', true,
  'advance_pay', true,
  'api_access', true,
  'multi_location', true,
  'email_reports', true,
  'advanced_reports', true
)
WHERE name = 'enterprise';