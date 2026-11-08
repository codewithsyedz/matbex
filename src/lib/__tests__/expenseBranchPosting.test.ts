/**
 * Regression suite: branch-wise expense posting + branch sub-account routing.
 * Mirrors post_expense_to_ledger / reclassify_expense_credit_account.
 */
import { describe, it, expect } from "vitest";
import {
  resolveBranchAccount,
  counterAccountCode,
  buildExpensePostingLegs,
  isBalanced,
  type CoaAccount,
} from "@/lib/expensePostingRouting";

const PARENT_EXPENSE = "acc-exp";
const PARENT_CASH = "acc-cash";
const PARENT_AP = "acc-ap";

const accounts: CoaAccount[] = [
  { id: PARENT_EXPENSE, account_code: "5000", account_name: "Food Cost", parent_id: null },
  { id: "exp-wadi", account_code: "5000-2", account_name: "Food Cost - Al-Wadi", parent_id: PARENT_EXPENSE },
  { id: "exp-hq", account_code: "5000-1", account_name: "Food Cost - Riyadh HQ", parent_id: PARENT_EXPENSE },
  { id: "exp-old", account_code: "5000-9", account_name: "Food Cost - Al-Wadi", parent_id: PARENT_EXPENSE, is_active: false },
  { id: PARENT_CASH, account_code: "1000", account_name: "Cash on Hand", parent_id: null },
  { id: "cash-wadi", account_code: "1000-2", account_name: "Cash on Hand - Al-Wadi", parent_id: PARENT_CASH },
  { id: PARENT_AP, account_code: "2000", account_name: "Accounts Payable", parent_id: null },
  { id: "ap-wadi", account_code: "2000-2", account_name: "Accounts Payable - Al-Wadi", parent_id: PARENT_AP },
];

const counters = { "1000": PARENT_CASH, "2000": PARENT_AP };

describe("resolveBranchAccount", () => {
  it("routes to the branch sub-account when one exists", () => {
    expect(resolveBranchAccount(PARENT_EXPENSE, "Al-Wadi", accounts)).toBe("exp-wadi");
    expect(resolveBranchAccount(PARENT_EXPENSE, "Riyadh HQ", accounts)).toBe("exp-hq");
  });

  it("is case-insensitive on branch name", () => {
    expect(resolveBranchAccount(PARENT_CASH, "al-wadi", accounts)).toBe("cash-wadi");
  });

  it("falls back to the parent when no branch sub-account exists", () => {
    expect(resolveBranchAccount(PARENT_CASH, "Riyadh HQ", accounts)).toBe(PARENT_CASH);
  });

  it("falls back to the parent for tenant-wide (no branch) postings", () => {
    expect(resolveBranchAccount(PARENT_EXPENSE, null, accounts)).toBe(PARENT_EXPENSE);
  });

  it("never routes to an inactive sub-account", () => {
    expect(resolveBranchAccount(PARENT_EXPENSE, "Al-Wadi", accounts)).not.toBe("exp-old");
  });
});

describe("counter account selection", () => {
  it("credits Cash on Hand for paid expenses and AP for unpaid", () => {
    expect(counterAccountCode("paid")).toBe("1000");
    expect(counterAccountCode("unpaid")).toBe("2000");
    expect(counterAccountCode(null)).toBe("2000");
  });
});

describe("buildExpensePostingLegs", () => {
  const base = {
    amount: 250,
    branchId: "branch-wadi",
    branchName: "Al-Wadi",
    debitAccountId: PARENT_EXPENSE,
    counterAccountIdByCode: counters,
    accounts,
  } as const;

  it("routes BOTH the debit and the credit leg to branch sub-accounts", () => {
    const legs = buildExpensePostingLegs({ ...base, status: "unpaid" });
    expect(legs.map((l) => l.accountId)).toEqual(["exp-wadi", "ap-wadi"]);
  });

  it("moves the credit from AP to Cash when the expense is paid", () => {
    const legs = buildExpensePostingLegs({ ...base, status: "paid" });
    expect(legs[1].accountId).toBe("cash-wadi");
    expect(legs[1].credit).toBe(250);
    expect(legs[1].debit).toBeNull();
  });

  it("stamps branch_id on every leg", () => {
    const legs = buildExpensePostingLegs({ ...base, status: "paid" });
    expect(legs.every((l) => l.branchId === "branch-wadi")).toBe(true);
  });

  it("keeps tenant-level postings on parent accounts with a null branch", () => {
    const legs = buildExpensePostingLegs({
      ...base,
      status: "unpaid",
      branchId: null,
      branchName: null,
    });
    expect(legs.map((l) => l.accountId)).toEqual([PARENT_EXPENSE, PARENT_AP]);
    expect(legs.every((l) => l.branchId === null)).toBe(true);
  });

  it("never mixes branches inside one batch", () => {
    const wadi = buildExpensePostingLegs({ ...base, status: "unpaid" });
    const hq = buildExpensePostingLegs({
      ...base,
      status: "unpaid",
      branchId: "branch-hq",
      branchName: "Riyadh HQ",
    });
    expect(new Set(wadi.map((l) => l.branchId)).size).toBe(1);
    expect(new Set(hq.map((l) => l.branchId)).size).toBe(1);
    expect(hq[0].accountId).toBe("exp-hq");
    // HQ has no cash sub-account -> parent fallback, still never the Wadi one
    expect(hq[1].accountId).not.toBe("ap-wadi");
  });

  it("throws when the counter account is missing instead of posting one-legged", () => {
    expect(() =>
      buildExpensePostingLegs({ ...base, status: "paid", counterAccountIdByCode: {} }),
    ).toThrow(/1000/);
  });

  it("always produces balanced DR/CR legs", () => {
    for (const amount of [0.01, 12.34, 250, 99999.99]) {
      for (const status of ["paid", "unpaid"] as const) {
        const legs = buildExpensePostingLegs({ ...base, amount, status });
        expect(legs).toHaveLength(2);
        expect(isBalanced(legs)).toBe(true);
      }
    }
  });

  it("flags unbalanced legs (guards the SQL balance assertion)", () => {
    expect(
      isBalanced([
        { accountId: "a", branchId: null, debit: 100, credit: null },
        { accountId: "b", branchId: null, debit: null, credit: 99.5 },
      ]),
    ).toBe(false);
  });
});
