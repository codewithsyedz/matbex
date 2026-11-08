import { describe, expect, it } from "vitest";
import { expenseAttention, summarizeAccountantExpenses, isAccountantDashboardRole, type AccountantExpense } from "./accountantDashboard";
const expense: AccountantExpense = { id: "1", amount: 115, paid_amount: 50, vat_amount: 15, expense_date: "2026-11-06", description: null, branch_id: "wadi", ledger_posted: true, approval_status: "approved", vat_split_status: "applied", account_id: "account", deleted_at: null };
describe("accountant dashboard rules", () => {
  it("routes an accountant but not an owner to the accountant dashboard", () => {
    expect(isAccountantDashboardRole(r => r === "accountant")).toBe(true);
    expect(isAccountantDashboardRole(r => ["accountant", "owner"].includes(r))).toBe(false);
  });
  it("counts period expenses and outstanding amounts excluding archived and rejected records", () => {
    expect(summarizeAccountantExpenses([expense, { ...expense, deleted_at: "2026-11-07" }, { ...expense, approval_status: "rejected" }, { ...expense, expense_date: "2026-10-01" }], "2026-11-01", "2026-11-30")).toEqual({ total: 115, unpaid: 65, vat: 15 });
  });
  it("separates pending VAT review from posting and mapping corrections", () => {
    expect(expenseAttention(expense)).toBe(null);
    expect(expenseAttention({ ...expense, vat_split_status: "pending" })).toBe("vat");
    expect(expenseAttention({ ...expense, ledger_posted: false })).toBe("posting");
    expect(expenseAttention({ ...expense, account_id: null })).toBe("mapping");
    expect(expenseAttention({ ...expense, approval_status: "rejected" })).toBe(null);
  });
});