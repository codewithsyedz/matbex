import { describe, it, expect } from "vitest";
import { isStarterPlan, isStarterAllowedPath, buildDailyRows } from "../starterPlan";

describe("starter plan", () => {
  it("detects starter plan", () => {
    expect(isStarterPlan({ name: "starter" })).toBe(true);
    expect(isStarterPlan({ name: "pro" })).toBe(false);
  });
  it("allows till and daily report but not accounting", () => {
    expect(isStarterAllowedPath("/dashboard")).toBe(true);
    expect(isStarterAllowedPath("/record-sale")).toBe(true);
    expect(isStarterAllowedPath("/daily-report")).toBe(true);
    expect(isStarterAllowedPath("/reports/profit-loss")).toBe(false);
    expect(isStarterAllowedPath("/accounting")).toBe(false);
    expect(isStarterAllowedPath("/accounting/zatca-provider")).toBe(true);
    expect(isStarterAllowedPath("/accounting/zatca-invoices")).toBe(false);
    expect(isStarterAllowedPath("/sales/analytics")).toBe(false);
  });
  it("computes daily profit", () => {
    const rows = buildDailyRows(
      [{ sales_date: "2026-09-29", cash_sales: 2148, card_sales: 533, delivery_sales: 0, other_sales: 0, status: "closed" }],
      [{ expense_date: "2026-09-29", amount: 681 }],
    );
    expect(rows[0].total).toBe(2681);
    expect(rows[0].total - rows[0].expenses).toBe(2000);
  });
});
