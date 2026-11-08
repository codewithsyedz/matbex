/**
 * AuthFacade — single public entrypoint for the auth provider tree.
 *
 * Phase 5 (AuthContext split) is delivered in two stages to keep blast radius
 * controlled across the ~195 consumer files:
 *
 *   Stage A (this PR):
 *     - `AuthCore` keeps the single-source-of-truth state, effects, and
 *       listeners exactly as they were. Behavior is byte-identical.
 *     - Five slice-specific hooks (`useSession`, `useProfile`, `useTenant`,
 *       `usePermissions`, `useImpersonation`) are exposed so new code can
 *       depend on a narrow concern instead of the whole `useAuth()` blob.
 *     - The legacy `useAuth()` shape and `AuthContext` export are preserved
 *       verbatim — no consumer needs to change.
 *
 *   Stage B (future PR, once consumers migrate to slice hooks):
 *     - Each slice gets its own `Context` + `Provider` so unrelated slices
 *       no longer re-render together (e.g. a tenant change won't re-render
 *       consumers that only read `session.user.id`).
 *
 * Doing this in two stages is deliberate: collapsing both stages into one
 * PR would mean rewriting state machine semantics (sign-out cascade,
 * impersonation re-fetch dependency on `user`, hydration ordering) while
 * simultaneously moving ~195 consumer call sites. Either alone is safe;
 * both together is how regressions sneak in.
 */
export {
  AuthProvider,
  AuthContext,
  useAuth,
  type ImpersonatableRole,
} from "./AuthCore";

export { useSession } from "./SessionContext";
export { useProfile } from "./ProfileContext";
export { useTenant } from "./TenantContext";
export { usePermissions } from "./PermissionsContext";
export { useImpersonation } from "./ImpersonationContext";