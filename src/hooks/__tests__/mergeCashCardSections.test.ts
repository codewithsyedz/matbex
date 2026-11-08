import { describe, expect, it } from "vitest";
import { mergeCashCardSections, type CashCardAnalysis } from "../useCashCardAnalysis";

const section = (currency: string, sales: number, n: number): CashCardAnalysis => ({
  currency,
  totals: { sales, transactions: n, avgTicket: sales / n, medianTicket: 5, days: 1 },
  methods: [{ method: "cash", sales, transactions: n, avgTicket: sales / n, medianTicket: 5 }],
  daily: [{ date: "2026-11-01", cash: sales, card: 0, other: 0, total: sales, cashTransactions: n, cardTransactions: 0, transactions: n, avgTicket: sales / n }],
  bands: [], hours: [], weekdays: [],
  branches: [{ branchId: currency, branchName: currency, currencyCode: currency, cash: sales, card: 0, other: 0, total: sales, cashTransactions: n, cardTransactions: 0, transactions: n, avgTicket: sales / n }],
});

// 1 AED = 1.02 SAR in this fake rate table
const toSar = (v: number, from: string) => (from === "AED" ? v * 1.02 : v);

describe("mergeCashCardSections", () => {
  it("converts each currency before adding totals", () => {
    const merged = mergeCashCardSections([section("SAR", 100, 10), section("AED", 100, 10)], toSar, "SAR");
    expect(merged.currency).toBe("SAR");
    expect(merged.totals.sales).toBeCloseTo(202);
    expect(merged.daily[0].total).toBeCloseTo(202);
    expect(merged.methods[0].sales).toBeCloseTo(202);
    expect(merged.totals.transactions).toBe(20);
    expect(Number.isNaN(merged.totals.medianTicket)).toBe(true);
  });

  it("leaves a single-currency report untouched", () => {
    const only = section("SAR", 100, 10);
    expect(mergeCashCardSections([only], toSar, "USD")).toBe(only);
  });
});
