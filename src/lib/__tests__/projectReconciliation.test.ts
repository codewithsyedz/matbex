import { describe, expect, it } from "vitest";
import { computeProjectReconciliation } from "@/lib/projectReconciliation";

const funders = (capital: number) => [
  { capital_balance: capital / 2, loan_balance: 0, payable_balance: 0 },
  { capital_balance: capital / 2, loan_balance: 0, payable_balance: 0 },
];

describe("project reconciliation", () => {
  it("TEST 1: posted acquisition fully funded by partners reconciles", () => {
    const r = computeProjectReconciliation({
      transactions: [],
      acquisition: { amount: 115000, classification_status: "posted" },
      funding: funders(115000),
    });
    expect(r.costTotal).toBe(115000);
    expect(r.fundingTotal).toBe(115000);
    expect(r.variance).toBe(0);
    expect(r.status).toBe("RECONCILED");
  });

  it("TEST 2: under-funded acquisition is not reconciled", () => {
    const r = computeProjectReconciliation({
      transactions: [],
      acquisition: { amount: 115000, classification_status: "posted" },
      funding: funders(100000),
    });
    expect(r.variance).toBe(15000);
    expect(r.status).toBe("NOT_RECONCILED");
  });

  it("TEST 3: draft acquisition is not project cost", () => {
    const r = computeProjectReconciliation({
      transactions: [],
      acquisition: { amount: 115000, classification_status: "classified" },
      funding: funders(115000),
    });
    expect(r.costTotal).toBe(0);
    expect(r.acquisitionCost).toBe(0);
  });

  it("TEST 4: acquisition-derived transactions are not double counted", () => {
    const r = computeProjectReconciliation({
      transactions: [
        { amount: 115000, status: "posted", source: "acquisition", paid_by: "partner", is_paid: true },
      ],
      acquisition: { amount: 115000, classification_status: "posted" },
      funding: funders(115000),
    });
    expect(r.costTotal).toBe(115000);
    expect(r.excludedCount).toBe(1);
    expect(r.status).toBe("RECONCILED");
  });

  it("TEST 5: a later posted company-paid adjustment stays balanced", () => {
    const r = computeProjectReconciliation({
      transactions: [
        { amount: 5000, status: "posted", source: "manual", paid_by: "company", is_paid: true },
      ],
      acquisition: { amount: 115000, classification_status: "posted" },
      funding: funders(115000),
    });
    expect(r.costTotal).toBe(120000);
    expect(r.fundingTotal).toBe(120000);
    expect(r.status).toBe("RECONCILED");
  });

  it("TEST 6: unrelated unposted transaction does not break reconciliation", () => {
    const r = computeProjectReconciliation({
      transactions: [
        { amount: 900, status: "needs_review", source: "import", paid_by: "company", is_paid: false },
      ],
      acquisition: { amount: 115000, classification_status: "posted" },
      funding: funders(115000),
    });
    expect(r.status).toBe("RECONCILED");
    expect(r.unclassifiedCount).toBe(1);
    expect(r.unpostedCount).toBe(1);
  });

  it("TEST 7: approved journal adjustments are included on both sides, acquisition untouched", () => {
    const r = computeProjectReconciliation({
      transactions: [],
      acquisition: { amount: 115000, classification_status: "posted" },
      funding: funders(115000),
      adjustments: [
        // approved + posted: counted
        { id: "a1", amount: 2500, side: "cost", approval_status: "approved", is_posted: true },
        { id: "a2", amount: 2500, side: "funding", approval_status: "approved", is_posted: true },
        // pending approval: ignored
        { id: "a3", amount: 9999, side: "cost", approval_status: "pending", is_posted: false },
        // voided: ignored
        { id: "a4", amount: 7777, side: "cost", approval_status: "approved", is_posted: true, is_voided: true },
        // acquisition-derived: ignored (acquisition header stays read-only)
        {
          id: "a5",
          amount: 115000,
          side: "cost",
          approval_status: "approved",
          is_posted: true,
          acquisition_derived: true,
        },
      ],
    });
    expect(r.acquisitionCost).toBe(115000);
    expect(r.costAdjustments).toBe(2500);
    expect(r.fundingAdjustments).toBe(2500);
    expect(r.adjustmentCount).toBe(2);
    expect(r.costTotal).toBe(117500);
    expect(r.fundingTotal).toBe(117500);
    expect(r.status).toBe("RECONCILED");
  });

  it("TEST 8: a negative approved adjustment reduces cost without editing the acquisition", () => {
    const r = computeProjectReconciliation({
      transactions: [],
      acquisition: { amount: 115000, classification_status: "posted" },
      funding: funders(110000),
      adjustments: [
        { id: "b1", amount: -5000, side: "cost", approval_status: "approved", is_posted: true },
      ],
    });
    expect(r.acquisitionCost).toBe(115000);
    expect(r.costTotal).toBe(110000);
    expect(r.variance).toBe(0);
    expect(r.status).toBe("RECONCILED");
  });
});
