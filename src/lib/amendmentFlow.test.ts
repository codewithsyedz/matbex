import { describe, it, expect } from "vitest";
import {
  AMEND_POSTED_EXPENSE_ROLES,
  canAmendPostedExpense,
  getMaterialExpenseChanges,
  requiresLedgerAdjustment,
} from "./postedExpenseGuard";
import { describeAmendError, AMEND_ROLE_ERROR } from "./amendmentErrors";

/** Every role in the `app_role` enum shipped by the migrations. */
const ALL_APP_ROLES = [
  "owner",
  "manager",
  "cashier",
  "superadmin",
  "accountant",
  "waiter",
] as const;

const hasOnly = (role: string) => (candidate: string) => candidate === role;

describe("posted expense amendment flow — role coverage", () => {
  it("allows the amendment flow for every supported restaurant role", () => {
    for (const role of AMEND_POSTED_EXPENSE_ROLES) {
      expect(
        canAmendPostedExpense(hasOnly(role)),
        `${role} should be able to amend posted expenses`
      ).toBe(true);
    }
  });

  it("blocks every role outside the supported set", () => {
    const blocked = ALL_APP_ROLES.filter(
      (r) => !(AMEND_POSTED_EXPENSE_ROLES as readonly string[]).includes(r)
    );
    expect(blocked.length).toBeGreaterThan(0);
    for (const role of blocked) {
      expect(
        canAmendPostedExpense(hasOnly(role)),
        `${role} must not be able to amend posted expenses`
      ).toBe(false);
    }
  });

  it("keeps the supported set inside the app_role enum", () => {
    for (const role of AMEND_POSTED_EXPENSE_ROLES) {
      expect(ALL_APP_ROLES).toContain(role);
    }
  });

  it("reaches the amendment dialog for a material change on a posted expense, for each supported role", () => {
    const before = {
      amount: 100,
      expenseDate: "2026-09-01",
      categoryId: "cat-1",
      accountId: "acc-1",
      supplierId: null,
    };
    const after = { ...before, amount: 125 };
    const changes = getMaterialExpenseChanges(before, after);
    expect(changes.map((c) => c.field)).toEqual(["amount"]);
    expect(requiresLedgerAdjustment(true, changes)).toBe(true);

    for (const role of AMEND_POSTED_EXPENSE_ROLES) {
      const canSubmit =
        requiresLedgerAdjustment(true, changes) &&
        canAmendPostedExpense(hasOnly(role));
      expect(canSubmit, `${role} should reach submit`).toBe(true);
    }
  });

  it("does not require an adjustment when nothing material changed", () => {
    const values = {
      amount: 100,
      expenseDate: "2026-09-01",
      categoryId: null,
      accountId: null,
      supplierId: null,
    };
    expect(requiresLedgerAdjustment(true, getMaterialExpenseChanges(values, values))).toBe(
      false
    );
  });
});

describe("amendment failure messaging", () => {
  it("maps role/permission failures to the actionable role message", () => {
    const raws = [
      "permission denied for function amend_posted_expense",
      "function public.has_role(uuid, app_role) does not exist",
      "Not authorized to amend posted expenses",
      "new row violates row-level security policy",
      "Amending a posted expense requires elevated access.",
    ];
    for (const raw of raws) {
      const info = describeAmendError(new Error(raw));
      expect(info.kind, raw).toBe("permission");
      expect(info.description).toBe(AMEND_ROLE_ERROR.description);
      expect(info.requiredRoles).toEqual(AMEND_POSTED_EXPENSE_ROLES);
    }
  });

  it("maps locked periods, unposted expenses and missing functions", () => {
    expect(describeAmendError(new Error("fiscal period is locked")).kind).toBe(
      "locked_period"
    );
    expect(describeAmendError(new Error("Expense is not posted")).kind).toBe(
      "not_posted"
    );
    expect(
      describeAmendError(new Error("Could not find the function public.amend_posted_expense"))
        .kind
    ).toBe("missing_function");
  });

  it("never leaks an empty message to the user", () => {
    for (const input of [null, undefined, {}, new Error("")]) {
      const info = describeAmendError(input);
      expect(info.title.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });
});
