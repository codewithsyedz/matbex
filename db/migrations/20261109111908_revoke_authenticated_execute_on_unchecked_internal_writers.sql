-- revoke_authenticated_execute_on_unchecked_internal_writers
--
-- 120 SECURITY DEFINER functions are executable by every logged-in user and never
-- check who is calling (no auth.uid()/JWT check, directly or through a helper that does).
-- Being SECURITY DEFINER they bypass RLS, so a user of one tenant can run them against
-- another tenant's ids. The 28 below also write data and are not called by the app as
-- a user: they run from cron (as the job owner), from other SECURITY DEFINER functions
-- (as the function owner), or from server functions with the service-role client. None
-- is referenced by an RLS policy or a SECURITY INVOKER function. They keep service_role.
--
-- Examples of what a logged-in user of any tenant could do before this:
--   ensure_standard_coa_accounts(other_tenant)   rename another tenant's accounts
--   post_waste_to_ledger(id), post_supplier_payment_to_ledger(id), ...  post someone else's documents
--   expire_trials(), sync_branch_seats_for_tenant(id), claim_promotion_slot(...)
--
-- The functions the browser does call without an ownership check need checks added to
-- their bodies; they are listed in docs/self-hosting/FUNCTION_ACCESS_REVIEW.md.

DO $$
DECLARE
  sig text;
  fn regprocedure;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.bump_menu_price_version(uuid,text)',
    'public.check_sale_posting_vat_integrity(uuid,text,uuid)',
    'public.claim_promotion_slot(uuid,uuid,numeric)',
    'public.detect_installment_vat_mismatch(uuid)',
    'public.ensure_aggregator_accounts(uuid)',
    'public.ensure_fixed_asset_disposal_accounts(uuid)',
    'public.ensure_installment_accounts(uuid)',
    'public.ensure_standard_coa_accounts(uuid)',
    'public.ensure_standard_coa_for_hybrid_pos(uuid)',
    'public.ensure_standard_ingredient_setup(uuid)',
    'public.expire_trials()',
    'public.mark_overdue_corrective_actions()',
    'public.notify_daily_overhead_posting(uuid,boolean,text)',
    'public.post_balance_adjustment_to_ledger(uuid)',
    'public.post_provisional_cogs_for_sale_item(uuid)',
    'public.post_supplier_payment_to_ledger(uuid)',
    'public.post_waste_to_ledger(uuid)',
    'public.post_waste_to_ledger(uuid,text)',
    'public.purge_edge_function_metrics()',
    'public.record_idempotency_replay(uuid,text)',
    'public.resolve_supplier_ap_account(uuid,uuid)',
    'public.reverse_provisional_cogs_for_sale_item(uuid,text)',
    'public.run_daily_reconciliation(uuid,date,numeric)',
    'public.seed_hybrid_pos_coa(uuid)',
    'public.seed_inventory_category_mappings(uuid)',
    'public.sweep_stale_impersonation_sessions()',
    'public.sync_branch_seats_for_tenant(uuid)',
    'public.update_session_activity(uuid)'
  ]
  LOOP
    fn := to_regprocedure(sig);
    CONTINUE WHEN fn IS NULL;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
