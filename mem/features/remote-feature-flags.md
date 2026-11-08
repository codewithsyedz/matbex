---
name: Remote Feature Flags
description: Supabase-backed runtime feature flags with realtime sync, managed via /admin/feature-flags
type: feature
---
- Table `public.feature_flags`: key (unique), enabled, description, rollout_tenant_ids[], disabled_tenant_ids[]
- RLS: any authenticated user can read; only superadmins (via `is_superadmin(uuid)` helper) can write
- Realtime enabled (REPLICA IDENTITY FULL); changes propagate without redeploy
- Hooks in `src/hooks/useFeatureFlags.ts`:
  - `useFeatureFlag(key, defaultValue?)` - boolean for current tenant. Override order: disabled_tenant_ids > rollout_tenant_ids > global enabled
  - `useFeatureFlags()` - full list
  - `useFeatureFlagAdmin()` - upsert/toggle/remove (superadmin only)
- Admin UI: `/admin/feature-flags` (AdminFeatureFlags page)
- Distinct from plan-based `hasFeature()` (subscription gating). Use remote flags for rollout control of in-progress features; use `hasFeature()` for paid-plan entitlements.
