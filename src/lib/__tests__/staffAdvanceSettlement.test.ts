import { describe, it, expect } from "vitest";
import {
  deriveAdvanceSettlement,
  summarizeAdvanceSettlements,
} from "@/lib/staffAdvanceSettlement";

describe("deriveAdvanceSettlement", () => {
  it("flags a fresh advance as outstanding", () => {
    const s = deriveAdvanceSettlement({ amount: 1000, status: "pending" });
    expect(s.outstanding).toBe(1000);
    expect(s.status).toBe("outstanding");
    expect(s.percentRepaid).toBe(0);
    expect(s.settled).toBe(false);
  });

  it("computes remaining due after a partial repayment", () => {
    const s = deriveAdvanceSettlement({ amount: 1000, repaid_amount: 250, status: "pending" });
    expect(s.outstanding).toBe(750);
    expect(s.status).toBe("partially_paid");
    expect(s.percentRepaid).toBe(25);
  });

  it("marks fully repaid advances as paid", () => {
    const s = deriveAdvanceSettlement({ amount: 1000, repaid_amount: 1000, status: "pending" });
    expect(s.outstanding).toBe(0);
    expect(s.status).toBe("paid");
    expect(s.settled).toBe(true);
  });

  it("treats payroll-deducted advances as paid regardless of repaid_amount", () => {
    const s = deriveAdvanceSettlement({ amount: 500, status: "deducted" });
    expect(s.status).toBe("paid");
    expect(s.outstanding).toBe(0);
  });

  it("treats forgiven advances as nothing due", () => {
    const s = deriveAdvanceSettlement({ amount: 500, repaid_amount: 100, status: "forgiven" });
    expect(s.status).toBe("forgiven");
    expect(s.outstanding).toBe(0);
  });

  it("treats reversed advances as reversed with no balance", () => {
    const s = deriveAdvanceSettlement({ amount: 500, status: "pending", ledger_reversed: true });
    expect(s.status).toBe("reversed");
    expect(s.outstanding).toBe(0);
  });

  it("clamps over-repayment and rounding noise", () => {
    const s = deriveAdvanceSettlement({ amount: 100, repaid_amount: 120, status: "pending" });
    expect(s.repaid).toBe(100);
    expect(s.outstanding).toBe(0);
    expect(s.status).toBe("paid");
  });

  it("settles sub-cent residuals", () => {
    const s = deriveAdvanceSettlement({ amount: 100, repaid_amount: 99.998, status: "pending" });
    expect(s.status).toBe("paid");
    expect(s.outstanding).toBe(0);
  });
});

describe("summarizeAdvanceSettlements", () => {
  it("aggregates totals and status counts", () => {
    const s = summarizeAdvanceSettlements([
      { amount: 1000, status: "pending" },
      { amount: 1000, repaid_amount: 400, status: "pending" },
      { amount: 500, status: "deducted" },
      { amount: 300, status: "forgiven" },
      { amount: 200, status: "pending", ledger_reversed: true },
    ]);
    expect(s.advanceTotal).toBe(2800);
    expect(s.outstandingTotal).toBe(1600);
    expect(s.repaidTotal).toBe(400);
    expect(s.forgivenTotal).toBe(300);
    expect(s.outstandingCount).toBe(1);
    expect(s.partialCount).toBe(1);
    expect(s.paidCount).toBe(1);
    expect(s.forgivenCount).toBe(1);
    expect(s.reversedCount).toBe(1);
  });

  it("returns zeroed summary for an empty list", () => {
    const s = summarizeAdvanceSettlements([]);
    expect(s.advanceTotal).toBe(0);
    expect(s.percentRepaid).toBe(0);
  });
});
