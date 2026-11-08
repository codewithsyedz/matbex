
-- 1) Lock down sensitive columns on public.plans for anonymous role.
-- Public registration still needs to display pricing, so we keep row-level
-- public read of active plans but revoke column-level access to the strategic
-- fields (feature flags + quota limits) for the anon role only.
REVOKE SELECT (default_feature_flags, quota_limits) ON public.plans FROM anon;

-- Ensure authenticated users keep full access (idempotent grant).
GRANT SELECT ON public.plans TO authenticated;

-- 2) Pin search_path for all remaining SECURITY DEFINER / public functions
--    flagged by the Supabase linter (CWE-94 mitigation).
ALTER FUNCTION public.post_waste_to_ledger(p_waste_id uuid, p_inventory_account_code text) SET search_path = public;
ALTER FUNCTION public.post_waste_to_ledger(p_waste_id uuid) SET search_path = public;
ALTER FUNCTION public.validate_transaction_account_mapping() SET search_path = public;
ALTER FUNCTION public.seed_hybrid_pos_coa(p_tenant_id uuid) SET search_path = public;
ALTER FUNCTION public.seed_sample_inventory_items(p_restaurant_id uuid) SET search_path = public;
ALTER FUNCTION public.auto_post_waste_to_ledger() SET search_path = public;
ALTER FUNCTION public.post_night_summary_to_ledger(p_summary_id uuid) SET search_path = public;
ALTER FUNCTION public.seed_inventory_category_mappings(p_tenant_id uuid) SET search_path = public;
ALTER FUNCTION public.ensure_standard_coa_for_hybrid_pos(p_tenant_id uuid) SET search_path = public;
ALTER FUNCTION public.cogs_trueup_compute_next_run() SET search_path = public;
