import { describe, expect, it } from "vitest";
import { expensesNetOfVat, zatcaNetSales } from "../ZatcaReconciliationCard";

describe("ZATCA reconciliation math", () => {
  it("removes VAT still inside expenses", () => {
    expect(expensesNetOfVat({ ledger_expenses: 1150, expense_vat_inside: 150 })).toBe(1000);
  });
  it("nets credit notes off filed sales", () => {
    expect(zatcaNetSales({ sales_filed_net: 5000, credit_notes_net: 200 })).toBe(4800);
  });
});
