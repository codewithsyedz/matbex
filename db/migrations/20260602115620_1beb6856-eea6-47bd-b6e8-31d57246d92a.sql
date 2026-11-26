-- Phase 1: Impersonation kill-switch. Seed a globally-enabled feature flag so
-- platform admins can disable "Test as…" without a redeploy, optionally per
-- tenant via the existing rollout_tenant_ids / disabled_tenant_ids columns.
INSERT INTO public.feature_flags (key, enabled, description)
VALUES (
  'impersonation_enabled',
  true,
  'Owner "Test as…" role impersonation. Disable globally to stop new sessions; existing heartbeats will auto-exit within 30s. Use disabled_tenant_ids to scope per tenant.'
)
ON CONFLICT (key) DO NOTHING;