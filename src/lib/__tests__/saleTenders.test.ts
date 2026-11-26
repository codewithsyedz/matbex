import { describe, it, expect } from "vitest";
import { amountsByMethod, tendersOf } from "@/lib/saleTenders";

describe("sale tenders", () => {
  it("splits a cash + card sale into its tenders", () => {
    const sale = { payment_method: "split", total: 100, sale_payments: [{ method: "cash", amount: "60.00" }, { method: "card", amount: 40 }] };
    expect(tendersOf(sale)).toEqual([{ method: "cash", amount: 60 }, { method: "card", amount: 40 }]);
  });

  it("treats a row read without tenders as one tender of its own method", () => {
    expect(tendersOf({ payment_method: "card", total: "25.5" })).toEqual([{ method: "card", amount: 25.5 }]);
  });

  it("sums by method across sales, voids included", () => {
    expect(
      amountsByMethod([
        { payment_method: "cash", total: 10, sale_payments: [{ method: "cash", amount: 10 }] },
        { payment_method: "split", total: 100, sale_payments: [{ method: "cash", amount: 60 }, { method: "card", amount: 40 }] },
        { payment_method: "split", total: -100, sale_payments: [{ method: "cash", amount: -60 }, { method: "card", amount: -40 }] },
        { payment_method: "card", total: 15 },
      ]),
    ).toEqual({ cash: 10, card: 15 });
  });
});
