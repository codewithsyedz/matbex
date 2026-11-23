import { describe, it, expect, vi } from "vitest";
import { chargeCardTenders, receiptTenders, splitIsComplete, tenderParts, toSalePayments, type DraftTender } from "@/lib/pos/splitTenders";
import { paymentMeansForTenders } from "@/lib/zatca/ubl";
import { buildClosingReport } from "@/lib/dailyClosingReport";

const d = (method: DraftTender["method"], amount: string, tendered = "", approval: DraftTender["approval"] = null): DraftTender =>
  ({ id: `${method}-${amount}`, method, amount, tendered, approval });

describe("split tenders on the POS", () => {
  it("is complete only when two or more tenders pay the total exactly", () => {
    expect(splitIsComplete([d("cash", "60"), d("card", "40")], 100)).toBe(true);
    expect(splitIsComplete([d("cash", "60"), d("card", "39.99")], 100)).toBe(false);
    expect(splitIsComplete([d("cash", "100")], 100)).toBe(false);
    expect(splitIsComplete([d("cash", "60", "50"), d("card", "40")], 100)).toBe(false); // cash short
    expect(splitIsComplete([d("other", "50"), d("other", "50")], 100)).toBe(false);
  });

  it("builds the API payments with cash given and card approvals", () => {
    const approval = { provider: "moyasar" as const, status: "approved", reference: "i1" };
    const parts = tenderParts([d("cash", "60", "100"), d("card", "40", "", approval), d("cash", "")]);
    expect(toSalePayments(parts)).toEqual([
      { method: "cash", amount: 60, tendered: 100, cardTerminal: null },
      { method: "card", amount: 40, tendered: null, cardTerminal: approval },
    ]);
    expect(receiptTenders(parts).map((p) => p.change_given)).toEqual([40, null]);
    expect(paymentMeansForTenders(parts).map((p) => p.code)).toEqual(["10", "48"]);
  });

  it("charges each unapproved card once and keeps approvals when a later card fails", async () => {
    const parts = tenderParts([d("card", "30"), d("cash", "40"), d("card", "30.5")]);
    const onApproved = vi.fn();
    const charge = vi.fn()
      .mockResolvedValueOnce({ provider: "hala", status: "approved", reference: "a" })
      .mockRejectedValueOnce(new Error("declined"));
    await expect(chargeCardTenders(parts, charge, onApproved)).rejects.toThrow("declined");
    expect(charge.mock.calls.map((c) => c[0])).toEqual([30, 30.5]);
    expect(onApproved).toHaveBeenCalledTimes(1);
    // Retry: the approved card is not charged again.
    const retry = vi.fn().mockResolvedValue({ provider: "hala", status: "approved", reference: "b" });
    await chargeCardTenders(parts, retry, onApproved);
    expect(retry.mock.calls.map((c) => c[0])).toEqual([30.5]);
  });
});

describe("day-end report reads tenders", () => {
  it("puts the cash and card parts of a split sale in their own columns", () => {
    const { rows } = buildClosingReport({
      branchNames: new Map(),
      summaryRows: [],
      adjRows: [],
      txRows: [
        { branch_id: "b1", created_at: "2026-08-01T09:00:00Z", total: 10, tax: 1.3, payment_method: "cash" },
        {
          branch_id: "b1", created_at: "2026-08-01T10:00:00Z", total: 100, tax: 13.04, payment_method: "split",
          sale_payments: [{ method: "cash", amount: 60 }, { method: "card", amount: 40 }],
        },
      ],
    });
    expect({ cash: rows[0].cash, card: rows[0].card, other: rows[0].other }).toEqual({ cash: 70, card: 40, other: 0 });
  });
});
