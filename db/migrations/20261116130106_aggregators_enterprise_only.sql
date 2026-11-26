-- aggregators_enterprise_only
--
-- Delivery Aggregators (Deliverect: Jahez, HungerStation, Keeta...) is an Enterprise feature
-- (decided 2026-11-16). The flag was off for everyone; it is now on, gated to Enterprise
-- (feature_flags.min_plan), with per-business rollout overrides still possible. The Enterprise
-- plan's feature list says so too; Starter and Growth say it is not included.
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
