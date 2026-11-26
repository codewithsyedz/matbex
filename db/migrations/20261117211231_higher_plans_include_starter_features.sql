-- Higher plans include what Starter includes. Trial, Growth (pro) and Enterprise never listed
-- the basic keys Starter has (pos, cash_drawer, daily_dashboard, inventory_basic, ...), so the
-- feature map showed Growth without a POS. Only keys a plan does not mention at all are added;
-- a key a plan sets explicitly (true or false) is left as it is.
UPDATE public.plans p
   SET default_feature_flags = s.extra || coalesce(p.default_feature_flags, '{}'::jsonb),
       updated_at = now()
  FROM (
    SELECT coalesce(jsonb_object_agg(k.key, true), '{}'::jsonb) AS extra
      FROM public.plans sp, jsonb_each(sp.default_feature_flags) k
     WHERE sp.name = 'starter' AND k.value = 'true'::jsonb
  ) s
 WHERE p.name IN ('trial', 'pro', 'enterprise');
