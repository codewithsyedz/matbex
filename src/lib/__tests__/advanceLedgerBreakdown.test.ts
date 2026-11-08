import { describe, it, expect } from "vitest";
import {
  buildAdvanceLedgerBreakdown,
  describeFundingAccounts,
  legKind,
  type BreakdownLeg,
} from "@/lib/advanceLedgerBreakdown";

const acct = (code: string, name: string) => ({ account_code: code, account_name: name });

const legs: BreakdownLeg[] = [
  { id: "1", debit: 1000, credit: 0, reference_type: "staff_advance", chart_of_accounts: acct("1150", "Employee Advances") },
  { id: "2", debit: 0, credit: 1000, reference_type: "staff_advance", chart_of_accounts: acct("1000", "Cash in Hand") },
  { id: "3", debit: 250, credit: 0, reference_type: "staff_advance_repayment", chart_of_accounts: acct("1000", "Cash in Hand") },
  { id: "4", debit: 0, credit: 250, reference_type: "staff_advance_repayment", chart_of_accounts: acct("1150", "Employee Advances") },
];

describe("buildAdvanceLedgerBreakdown", () => {
  it("groups legs per account with DR/CR totals", () => {
    const b = buildAdvanceLedgerBreakdown(legs);
    expect(b.rows).toHaveLength(2);
    const advances = b.rows.find((r) => r.accountCode === "1150")!;
    expect(advances.debit).toBe(1000);
    expect(advances.credit).toBe(250);
    expect(advances.net).toBe(750);
    expect(advances.side).toBe("debit");
    expect(advances.legCount).toBe(2);
  });

  it("identifies credited and debited accounts", () => {
    const b = buildAdvanceLedgerBreakdown(legs);
    expect(b.creditedAccounts.map((r) => r.accountCode)).toEqual(["1000"]);
    expect(b.debitedAccounts.map((r) => r.accountCode)).toEqual(["1150"]);
  });

  it("reports balanced totals", () => {
    const b = buildAdvanceLedgerBreakdown(legs);
    expect(b.totalDebit).toBe(1250);
    expect(b.totalCredit).toBe(1250);
    expect(b.balanced).toBe(true);
    expect(b.legCount).toBe(4);
  });

  it("excludes voided legs but counts them", () => {
    const b = buildAdvanceLedgerBreakdown([
      ...legs,
      { id: "5", debit: 500, credit: 0, is_voided: true, reference_type: "staff_advance", chart_of_accounts: acct("1150", "Employee Advances") },
    ]);
    expect(b.totalDebit).toBe(1250);
    expect(b.voidedLegCount).toBe(1);
  });

  it("handles unmapped accounts", () => {
    const b = buildAdvanceLedgerBreakdown([
      { id: "x", debit: 10, credit: 0, reference_type: "staff_advance", chart_of_accounts: null },
    ]);
    expect(b.rows[0].accountCode).toBe("—");
    expect(b.rows[0].accountName).toBe("Unmapped account");
  });

  it("describes the funding account from the original posting", () => {
    expect(describeFundingAccounts(buildAdvanceLedgerBreakdown(legs))).toBe("1000 · Cash in Hand");
  });

  it("falls back when nothing is posted", () => {
    expect(describeFundingAccounts(buildAdvanceLedgerBreakdown([]))).toBe(
      "No credited account posted yet"
    );
  });

  it("maps reference types to leg kinds", () => {
    expect(legKind("staff_advance")).toBe("original");
    expect(legKind("staff_advance_repayment")).toBe("repayment");
    expect(legKind("staff_advance_reversal")).toBe("reversal");
    expect(legKind("advance_deduction")).toBe("deduction");
    expect(legKind(null)).toBe("other");
  });

  it("credits an equity capital account when the owner funded the advance", () => {
    const b = buildAdvanceLedgerBreakdown([
      { id: "1", debit: 800, credit: 0, reference_type: "staff_advance", chart_of_accounts: acct("1150", "Employee Advances") },
      { id: "2", debit: 0, credit: 800, reference_type: "staff_advance", chart_of_accounts: acct("3401", "Owner Capital - Ali") },
    ]);
    expect(describeFundingAccounts(b)).toBe("3401 · Owner Capital - Ali");
  });
});
