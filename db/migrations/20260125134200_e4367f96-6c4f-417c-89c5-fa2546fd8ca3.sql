-- Update Free plan to add accounting = false
UPDATE public.plans 
SET default_feature_flags = jsonb_set(
  COALESCE(default_feature_flags, '{}'::jsonb), 
  '{accounting}', 
  'false'::jsonb
)
WHERE name = 'free';

-- Update Pro plan to add accounting = true
UPDATE public.plans 
SET default_feature_flags = jsonb_set(
  COALESCE(default_feature_flags, '{}'::jsonb), 
  '{accounting}', 
  'true'::jsonb
)
WHERE name = 'pro';

-- Update Enterprise plan to add accounting = true
UPDATE public.plans 
SET default_feature_flags = jsonb_set(
  COALESCE(default_feature_flags, '{}'::jsonb), 
  '{accounting}', 
  'true'::jsonb
)
WHERE name = 'enterprise';