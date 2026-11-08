/**
 * Pure permissions selector — single source of truth for role checks and
 * "Test as…" impersonation overrides. Kept dependency-free so it can be
 * unit-tested without React, Supabase, or any browser API.
 *
 * Consumers:
 *   - AuthContext (wires the selector into live state)
 *   - usePermissions() hook (read-only facade for components)
 *   - permissions.test.ts (unit tests)
 */

export type AppRole =
  | "owner"
  | "manager"
  | "cashier"
  | "accountant"
  | "superadmin";

export type ImpersonatableRole = "manager" | "accountant" | "cashier";

export interface PermissionsInput {
  /** Raw user_tenant_roles rows (only `role` is read). */
  roles: ReadonlyArray<{ role: AppRole }>;
  /** Currently active "Test as…" role, or null when not impersonating. */
  impersonatedRole: ImpersonatableRole | null;
  /** Tenant flags consulted for derived permissions. */
  tenant: { accountant_can_post_journals?: boolean | null } | null;
}

export interface EffectivePermissions {
  /** True when impersonation is active AND user is a real owner. */
  isRoleImpersonating: boolean;
  /** True when this user is allowed to start a "Test as…" session. */
  canImpersonateRoles: boolean;
  /** True when the user *really* holds the owner role (never overridden). */
  realIsOwner: boolean;
  /** Role checks AFTER impersonation override. */
  hasRole: (role: "owner" | "manager" | "cashier" | "accountant") => boolean;
  isOwner: boolean;
  isManager: boolean;
  isAccountant: boolean;
  /**
   * True when the (effective) user may post journal entries. Owners and
   * managers always qualify; accountants only when the tenant has
   * `accountant_can_post_journals` enabled.
   */
  canPostJournals: boolean;
}

const NON_OVERRIDABLE_OWNER = false;

/**
 * Derive every role / impersonation flag from raw inputs. Pure function:
 * same inputs → same outputs, no side effects, no dependencies.
 */
export function selectEffectivePermissions(
  input: PermissionsInput,
): EffectivePermissions {
  const { roles, impersonatedRole, tenant } = input;

  const realIsOwner = roles.some((r) => r.role === "owner");
  const realIsManager = roles.some((r) => r.role === "manager");
  const realIsAccountant = roles.some((r) => r.role === "accountant");
  const isSuperAdmin = roles.some((r) => r.role === "superadmin");

  // Only real owners (never SuperAdmins) may use "Test as…".
  const canImpersonateRoles = realIsOwner && !isSuperAdmin;
  const isRoleImpersonating = !!impersonatedRole && realIsOwner;

  const accountantCanPost = tenant?.accountant_can_post_journals === true;

  // Real (non-overridden) computed flags.
  const realRoleSet = new Set(roles.map((r) => r.role));
  const realHasRole = (
    role: "owner" | "manager" | "cashier" | "accountant",
  ) => realRoleSet.has(role);
  const realIsManagerEff = realIsManager || realIsOwner;
  const realCanPost =
    realIsManagerEff || (realIsAccountant && accountantCanPost);

  if (!isRoleImpersonating) {
    return {
      isRoleImpersonating: false,
      canImpersonateRoles,
      realIsOwner,
      hasRole: realHasRole,
      isOwner: realIsOwner,
      isManager: realIsManagerEff,
      isAccountant: realIsAccountant,
      canPostJournals: realCanPost,
    };
  }

  // Impersonation active: the owner adopts the impersonated role exclusively.
  const role = impersonatedRole as ImpersonatableRole;
  return {
    isRoleImpersonating: true,
    canImpersonateRoles,
    realIsOwner,
    hasRole: (r) => r === role,
    isOwner: NON_OVERRIDABLE_OWNER, // owner deliberately drops privileges
    isManager: role === "manager",
    isAccountant: role === "accountant",
    canPostJournals:
      role === "manager" || (role === "accountant" && accountantCanPost),
  };
}
