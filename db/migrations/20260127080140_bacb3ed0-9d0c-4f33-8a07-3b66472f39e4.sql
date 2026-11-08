-- Update Free plan: no web_builder or custom_domain
UPDATE public.plans 
SET default_feature_flags = default_feature_flags || jsonb_build_object('web_builder', false, 'custom_domain', false)
WHERE name = 'free';

-- Update Pro plan: has web_builder and 1 custom_domain
UPDATE public.plans 
SET default_feature_flags = default_feature_flags || jsonb_build_object('web_builder', true, 'custom_domain', true)
WHERE name = 'pro';

-- Update Enterprise plan: has web_builder and unlimited custom_domains
UPDATE public.plans 
SET default_feature_flags = default_feature_flags || jsonb_build_object('web_builder', true, 'custom_domain', true)
WHERE name = 'enterprise';