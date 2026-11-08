import { describe, expect, it } from "vitest";
import { canAddInventory, correctedExpenseTotals } from "./accountantCorrections";
import { canAmendPostedExpense, getMaterialExpenseChanges, requiresLedgerAdjustment } from "./postedExpenseGuard";

describe("accountant corrections", () => {
  it("permits accountant inventory creation but not cashier or waiter", () => {
    expect(canAddInventory(r => r === "accountant")).toBe(true);
    expect(canAddInventory(r => r === "cashier")).toBe(false);
    expect(canAddInventory(r => r === "waiter")).toBe(false);
  });
  it("allows an accountant to correct a posted expense amount through an adjustment", () => {
    const original = { amount: 115, expenseDate: "2026-11-06", categoryId: null, accountId: "expense", supplierId: null };
    const changes = getMaterialExpenseChanges(original, { ...original, amount: 230 });
    expect(canAmendPostedExpense(r => r === "accountant")).toBe(true);
    expect(requiresLedgerAdjustment(true, changes)).toBe(true);
    expect(correctedExpenseTotals(230, 115, 15)).toEqual({ vat: 30, net: 200 });
  });
  it("VAT removal leaves the full expense amount unchanged", () => {
    expect(correctedExpenseTotals(115, 115, 0)).toEqual({ vat: 0, net: 115 });
  });
});