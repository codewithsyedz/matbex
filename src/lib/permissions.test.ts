import { describe, it, expect } from "vitest";
import { selectEffectivePermissions, type AppRole } from "./permissions";

const rolesOf = (...rs: AppRole[]) => rs.map((role) => ({ role }));

describe("selectEffectivePermissions — baseline (no impersonation)", () => {
  it("flags an owner as owner+manager and lets them post journals", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: null,
      tenant: null,
    });
    expect(p.isOwner).toBe(true);
    expect(p.isManager).toBe(true); // owner implies manager
    expect(p.hasRole("owner")).toBe(true);
    expect(p.canPostJournals).toBe(true);
    expect(p.canImpersonateRoles).toBe(true);
    expect(p.isRoleImpersonating).toBe(false);
  });

  it("flags a manager (not owner) correctly", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("manager"),
      impersonatedRole: null,
      tenant: null,
    });
    expect(p.isOwner).toBe(false);
    expect(p.isManager).toBe(true);
    expect(p.canPostJournals).toBe(true);
    expect(p.canImpersonateRoles).toBe(false);
  });

  it("cashier-only: no manager, no posting, no impersonation rights", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("cashier"),
      impersonatedRole: null,
      tenant: null,
    });
    expect(p.isOwner).toBe(false);
    expect(p.isManager).toBe(false);
    expect(p.isAccountant).toBe(false);
    expect(p.hasRole("cashier")).toBe(true);
    expect(p.canPostJournals).toBe(false);
    expect(p.canImpersonateRoles).toBe(false);
  });

  it("accountant can post only when tenant flag is on", () => {
    const off = selectEffectivePermissions({
      roles: rolesOf("accountant"),
      impersonatedRole: null,
      tenant: { accountant_can_post_journals: false },
    });
    const on = selectEffectivePermissions({
      roles: rolesOf("accountant"),
      impersonatedRole: null,
      tenant: { accountant_can_post_journals: true },
    });
    expect(off.canPostJournals).toBe(false);
    expect(on.canPostJournals).toBe(true);
  });

  it("SuperAdmin cannot use Test as…, even if they also hold owner", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner", "superadmin"),
      impersonatedRole: null,
      tenant: null,
    });
    expect(p.canImpersonateRoles).toBe(false);
  });
});

describe("selectEffectivePermissions — owner impersonating a role", () => {
  it("owner→cashier loses owner/manager and looks like a cashier", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "cashier",
      tenant: null,
    });
    expect(p.isRoleImpersonating).toBe(true);
    expect(p.isOwner).toBe(false);
    expect(p.isManager).toBe(false);
    expect(p.isAccountant).toBe(false);
    expect(p.hasRole("cashier")).toBe(true);
    expect(p.hasRole("owner")).toBe(false);
    expect(p.hasRole("manager")).toBe(false);
    expect(p.canPostJournals).toBe(false);
  });

  it("owner→manager keeps posting rights but drops owner flag", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "manager",
      tenant: null,
    });
    expect(p.isOwner).toBe(false);
    expect(p.isManager).toBe(true);
    expect(p.canPostJournals).toBe(true);
  });

  it("owner→accountant respects accountant_can_post_journals flag", () => {
    const off = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "accountant",
      tenant: { accountant_can_post_journals: false },
    });
    const on = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "accountant",
      tenant: { accountant_can_post_journals: true },
    });
    expect(off.isAccountant).toBe(true);
    expect(off.canPostJournals).toBe(false);
    expect(on.canPostJournals).toBe(true);
  });

  it("non-owner cannot override their role via impersonatedRole", () => {
    // Defense in depth: even if sessionStorage is tampered to set a role,
    // a non-owner stays in their real role.
    const p = selectEffectivePermissions({
      roles: rolesOf("manager"),
      impersonatedRole: "cashier",
      tenant: null,
    });
    expect(p.isRoleImpersonating).toBe(false);
    expect(p.isManager).toBe(true);
    expect(p.hasRole("cashier")).toBe(false);
  });
});

/**
 * Mirrors the CASHIER_ALLOWED_ROUTES check in `src/components/ProtectedRoute.tsx`.
 * Keeping a copy of the route-lock predicate here lets us regression-test the
 * impersonation interaction (owner→cashier must be redirected off /dashboard
 * to /record-sale) without spinning up the full router.
 */
const CASHIER_ALLOWED_ROUTES = [
  "/shifts",
  "/record-sale",
  "/chat",
  "/online-orders",
  "/order-manager",
];
const isCashierRouteAllowed = (path: string) =>
  CASHIER_ALLOWED_ROUTES.some(
    (r) => path === r || path.startsWith(r + "/"),
  );

describe("ProtectedRoute interaction — cashier route lock + impersonation", () => {
  it("owner impersonating cashier is treated as cashier-only", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "cashier",
      tenant: null,
    });
    const isCashierOnly =
      p.hasRole("cashier") && !p.isManager && !p.isOwner;
    expect(isCashierOnly).toBe(true);
  });

  it("owner→cashier is blocked from /dashboard but allowed on /record-sale", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "cashier",
      tenant: null,
    });
    const isCashierOnly =
      p.hasRole("cashier") && !p.isManager && !p.isOwner;
    expect(isCashierOnly && !isCashierRouteAllowed("/dashboard")).toBe(true);
    expect(isCashierRouteAllowed("/record-sale")).toBe(true);
    expect(isCashierRouteAllowed("/shifts")).toBe(true);
    expect(isCashierRouteAllowed("/shifts/123")).toBe(true);
  });

  it("plain owner (no impersonation) is NOT cashier-only and keeps access", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: null,
      tenant: null,
    });
    const isCashierOnly =
      p.hasRole("cashier") && !p.isManager && !p.isOwner;
    expect(isCashierOnly).toBe(false);
  });

  it("owner→manager is NOT cashier-locked", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "manager",
      tenant: null,
    });
    const isCashierOnly =
      p.hasRole("cashier") && !p.isManager && !p.isOwner;
    expect(isCashierOnly).toBe(false);
  });
});
