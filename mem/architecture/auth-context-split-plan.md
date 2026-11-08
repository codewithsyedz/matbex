---
name: AuthContext provider decomposition plan (deferred)
description: Future migration to split AuthContext into Session/Profile/Tenant/Permissions/Impersonation providers
type: reference
---

`src/contexts/AuthContext.tsx` mixes session, profile, tenant, restaurant, plan, roles, impersonation, heartbeat lifecycle, and beforeunload listeners. It is the project's single point of failure — a regression here breaks every page.

**Target decomposition (NOT yet implemented):**
```
<SessionProvider>            // auth.session, supabase.auth listener, signOut
  <ProfileProvider>          // profile row + tenant_id derivation
    <TenantProvider>         // tenant, restaurant, plan, plan_overrides
      <PermissionsProvider>  // role, branch pins, has_permission()
        <ImpersonationProvider>  // active impersonation + heartbeat + sweeper
```

**Migration strategy when this work is picked up:**
1. Create new providers as thin wrappers around current AuthContext (no behavior change). Land + verify.
2. Move state ownership one provider at a time, top-down. Keep `useAuth()` as a facade re-exporting merged values — zero breaking changes to consumers.
3. Codemod `useAuth()` call sites to specific hooks (`useSession`, `useTenant`, …). Bundle splitter tree-shakes unused subscribers.
4. Delete the `useAuth()` facade.

**Why deferred:** Touches every page; needs its own PR with dedicated QA. Ship in isolation, not bundled with other architecture work.

**Risk if skipped:** Every new piece of state added to AuthContext compounds the blast radius. Resist the temptation to "just add one more field".