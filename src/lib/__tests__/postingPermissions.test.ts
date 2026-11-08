/**
 * Posting Center permission gates.
 *
 * The Posting Center UI computes `canPost` / `canReconcile` from the same
 * permissions selector that drives every other accounting screen — owners,
 * managers, and accountants are allowed; everyone else is read-only. The
 * SECURITY DEFINER RPCs on the server enforce the same check, so the UI
 * gate is the first line of defense, not the only one.
 *
 * These tests pin that contract so a future refactor can't silently widen
 * the permission surface (e.g. letting a cashier trigger `bulk_post`).
 */
import { describe, it, expect } from "vitest";
import {
  selectEffectivePermissions,
  type AppRole,
} from "@/lib/permissions";

const rolesOf = (...rs: AppRole[]) => rs.map((role) => ({ role }));

/** Mirrors the gate used in UnpostedLedgerPanel / ImbalancedPanel. */
function canRunPostingActions(
  ...rs: AppRole[]
) {
  const p = selectEffectivePermissions({
    roles: rolesOf(...rs),
    impersonatedRole: null,
    tenant: null,
  });
  return p.isOwner || p.isManager || p.isAccountant;
}

describe("Posting Center role gate (bulk post / retry / reconcile)", () => {
  it("allows owners", () => {
    expect(canRunPostingActions("owner")).toBe(true);
  });
  it("allows managers", () => {
    expect(canRunPostingActions("manager")).toBe(true);
  });
  it("allows accountants", () => {
    expect(canRunPostingActions("accountant")).toBe(true);
  });
  it("blocks cashiers", () => {
    expect(canRunPostingActions("cashier")).toBe(false);
  });
  it("blocks users with no tenant role", () => {
    expect(canRunPostingActions()).toBe(false);
  });
});

describe("Posting Center role gate under owner impersonation", () => {
  it("owner testing as cashier loses bulk-post privileges", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "cashier",
      tenant: null,
    });
    expect(p.isOwner).toBe(false);
    expect(p.isManager).toBe(false);
    expect(p.isAccountant).toBe(false);
    expect(p.isOwner || p.isManager || p.isAccountant).toBe(false);
  });

  it("owner testing as accountant can still bulk post", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "accountant",
      tenant: null,
    });
    expect(p.isAccountant).toBe(true);
    expect(p.isOwner || p.isManager || p.isAccountant).toBe(true);
  });

  it("owner testing as manager retains posting rights", () => {
    const p = selectEffectivePermissions({
      roles: rolesOf("owner"),
      impersonatedRole: "manager",
      tenant: null,
    });
    expect(p.isManager).toBe(true);
    expect(p.isOwner || p.isManager || p.isAccountant).toBe(true);
  });
});