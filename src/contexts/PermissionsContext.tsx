/**
 * Read-only facade over AuthContext for everything role / impersonation
 * related. New code should prefer `usePermissions()` over `useAuth()` when it
 * only needs to make a permission decision — this keeps identity (session,
 * profile, tenant data) decoupled from authorization derivations and gives us
 * a stable surface to migrate to a dedicated provider later without touching
 * call sites.
 *
 * The actual derivation lives in `src/lib/permissions.ts` (pure, unit-tested).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAYERING / DRIFT NOTE — read before adding fields here
 * ─────────────────────────────────────────────────────────────────────────────
 * This is intentionally a **thin facade**, not a sibling provider. AuthContext
 * remains the single source of truth for role state; PermissionsContext only
 * re-exposes the subset of fields that `selectEffectivePermissions` derives,
 * so the two cannot diverge by construction. If you find yourself adding
 * state here that does NOT come from `useAuth()`, stop and finish the
 * extraction instead (move the state into a new provider and have AuthContext
 * consume *it*).
 *
 * SECURITY BOUNDARY — impersonation is a UX preview, NOT an authz boundary.
 * `selectEffectivePermissions` runs client-side. RLS policies and edge
 * functions still see the real `auth.uid()` and its real roles. An owner
 * impersonating a cashier can still hit owner-only tables via direct
 * PostgREST calls — the UI just hides the affordances. If you need a true
 * server-enforced impersonation boundary, that requires setting a session
 * GUC in a SECURITY DEFINER RPC and reading it from RLS; do not infer
 * server-side authorization from anything this hook returns.
 */
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { ImpersonatableRole } from "@/lib/permissions";

export interface PermissionsView {
  hasRole: (role: "owner" | "manager" | "cashier" | "accountant") => boolean;
  isOwner: boolean;
  isManager: boolean;
  isAccountant: boolean;
  canPostJournals: boolean;
  isRoleImpersonating: boolean;
  impersonatedRole: ImpersonatableRole | null;
  canImpersonateRoles: boolean;
}

export function usePermissions(): PermissionsView {
  const {
    hasRole,
    isOwner,
    isManager,
    isAccountant,
    canPostJournals,
    isRoleImpersonating,
    impersonatedRole,
    canImpersonateRoles,
  } = useAuth();

  return useMemo(
    () => ({
      hasRole,
      isOwner,
      isManager,
      isAccountant,
      canPostJournals,
      isRoleImpersonating,
      impersonatedRole,
      canImpersonateRoles,
    }),
    [
      hasRole,
      isOwner,
      isManager,
      isAccountant,
      canPostJournals,
      isRoleImpersonating,
      impersonatedRole,
      canImpersonateRoles,
    ],
  );
}
