-- feature_flags_plan_gate
--
-- get_feature_flags_for_tenant (how non-superadmin sessions read flags) ignored feature_flags.min_plan,
-- so a plan-gated flag showed as on for every plan in the app (the server checks still refused).
-- Apply the same rule as the app's useFeatureFlag: disabled list wins; rollout list turns a flag
-- on regardless of plan; otherwise on when enabled and the business's plan meets min_plan.
CREATE OR REPLACE FUNCTION public.get_feature_flags_for_tenant(_tenant_id uuid)
 RETURNS TABLE(flag_key text, is_enabled boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT CASE lower(coalesce(p.name, ''))
             WHEN 'trial' THEN 0 WHEN 'free' THEN 1 WHEN 'pro' THEN 2 WHEN 'enterprise' THEN 3 ELSE -1 END AS rank
    FROM public.tenants tn LEFT JOIN public.plans p ON p.id = tn.plan_id
    WHERE tn.id = _tenant_id
  )
  SELECT
    ff.key AS flag_key,
    CASE
      WHEN _tenant_id = ANY (COALESCE(ff.disabled_tenant_ids, ARRAY[]::uuid[])) THEN false
      WHEN _tenant_id = ANY (COALESCE(ff.rollout_tenant_ids, ARRAY[]::uuid[])) THEN true
      WHEN ff.enabled AND (
        ff.min_plan IS NULL
        OR COALESCE((SELECT rank FROM t), -1) >= CASE lower(ff.min_plan)
             WHEN 'trial' THEN 0 WHEN 'free' THEN 1 WHEN 'pro' THEN 2 WHEN 'enterprise' THEN 3 ELSE 0 END
      ) THEN true
      ELSE false
    END
  FROM public.feature_flags ff
  WHERE is_superadmin(auth.uid())
     OR EXISTS (
       SELECT 1 FROM public.user_tenant_roles utr
       WHERE utr.user_id = auth.uid() AND utr.tenant_id = _tenant_id
     );
$function$;
