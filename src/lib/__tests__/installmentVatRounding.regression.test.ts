import { describe, it, expect } from "vitest";
import {
  sumInstallmentVat,
  breakdownInstallmentVat,
  reconcileVatRecoverable,
  type InstallmentVatPlan,
  type VatLedgerLine,
} from "@/lib/vatRecoverableReconciliation";

/**
 * Regression coverage for VAT rounding / tolerance edge cases on installment
 * (BNPL) purchases. These plans post input VAT straight to the ledger, so a
 * sub-halala rounding difference between the plan row and the posted leg must
 * not be reported as a real reconciliation gap — and anything above the
 * tolerance must be.
 */

const BRANCH_A = "branch-a";
const BRANCH_B = "branch-b";

function ledger(vat: number, date = "2026-08-05", batch = "batch-1"): VatLedgerLine[] {
  return [{ batch_id: batch, debit: vat, credit: 0, transaction_date: date, account_code: "1180" }];
}

function plan(over: Partial<InstallmentVatPlan> & { id?: string } = {}): InstallmentVatPlan & { id: string } {
  return {
    id: over.id ?? "plan-1",
    vat_amount: 0,
    finance_vat_amount: 0,
    status: "active",
    branch_id: BRANCH_A,
    purchase_date: "2026-08-05",
    ...over,
  };
}

describe("installment VAT rounding — aggregation", () => {
  it("rounds the aggregate, not each plan, so third-decimal noise does not drift", () => {
    const plans = [
      plan({ id: "p1", vat_amount: 0.004 }),
      plan({ id: "p2", vat_amount: 0.004 }),
      plan({ id: "p3", vat_amount: 0.004 }),
    ];
    // 0.012 total -> 0.01 (per-plan rounding would have given 0.00)
    expect(sumInstallmentVat(plans)).toBe(0.01);
  });

  it("keeps 15% VAT on a repeating-decimal base within a halala", () => {
    // 3,006.95 goods @ 15% = 451.0425
    const plans = [plan({ vat_amount: 3006.95 * 0.15 })];
    expect(sumInstallmentVat(plans)).toBe(451.04);
  });

  it("does not accumulate float error over many small plans", () => {
    const plans = Array.from({ length: 100 }, (_, i) => plan({ id: `p${i}`, vat_amount: 0.1 }));
    expect(sumInstallmentVat(plans)).toBe(10);
  });

  it("sums goods and finance VAT before rounding", () => {
    const plans = [plan({ vat_amount: 12.005, finance_vat_amount: 3.004 })];
    // 15.009 -> 15.01
    expect(sumInstallmentVat(plans)).toBe(15.01);
  });

  it("rounds half up on an exact .005 boundary", () => {
    expect(sumInstallmentVat([plan({ vat_amount: 1.005 })])).toBe(1.01);
    expect(sumInstallmentVat([plan({ vat_amount: 2.675 })])).toBe(2.68);
  });

  it("handles negative (credit-note) VAT: half-halala rounds toward zero", () => {
    // Math.round is half-up, so -0.005 collapses to 0 rather than -0.01.
    // Documented here so a future rounding change is caught deliberately.
    const plans = [plan({ id: "p1", vat_amount: 451.04 }), plan({ id: "p2", vat_amount: -451.045 })];
    expect(Math.abs(sumInstallmentVat(plans))).toBe(0);
  });

  it("keeps credit notes larger than a halala on the source side", () => {
    const plans = [plan({ id: "p1", vat_amount: 451.04 }), plan({ id: "p2", vat_amount: -451.06 })];
    expect(sumInstallmentVat(plans)).toBe(-0.02);
  });
});

describe("installment VAT rounding — branch scoping", () => {
  const plans = [
    plan({ id: "a1", branch_id: BRANCH_A, vat_amount: 100.005 }),
    plan({ id: "a2", branch_id: BRANCH_A, vat_amount: 0.004 }),
    plan({ id: "b1", branch_id: BRANCH_B, vat_amount: 50.004 }),
    plan({ id: "b2", branch_id: BRANCH_B, vat_amount: 0.005 }),
  ];

  it("rounds within each branch independently", () => {
    expect(sumInstallmentVat(plans, { branchId: BRANCH_A })).toBe(100.01);
    expect(sumInstallmentVat(plans, { branchId: BRANCH_B })).toBe(50.01);
  });

  it("per-branch rounded totals may differ from the tenant total by cents", () => {
    const tenant = sumInstallmentVat(plans); // 150.018 -> 150.02
    const perBranch =
      sumInstallmentVat(plans, { branchId: BRANCH_A }) + sumInstallmentVat(plans, { branchId: BRANCH_B });
    expect(tenant).toBe(150.02);
    expect(Math.abs(perBranch - tenant)).toBeLessThanOrEqual(0.02);
  });

  it("excludes plans with a null branch when a branch filter is applied", () => {
    const withUnassigned = [...plans, plan({ id: "u1", branch_id: null, vat_amount: 999 })];
    expect(sumInstallmentVat(withUnassigned, { branchId: BRANCH_A })).toBe(100.01);
    expect(sumInstallmentVat(withUnassigned)).toBe(1149.02);
  });
});

describe("installment VAT rounding — date windows", () => {
  const plans = [
    plan({ id: "d1", purchase_date: "2026-07-31", vat_amount: 10.004 }),
    plan({ id: "d2", purchase_date: "2026-08-01", vat_amount: 20.005 }),
    plan({ id: "d3", purchase_date: "2026-08-31", vat_amount: 30.006 }),
    plan({ id: "d4", purchase_date: "2026-09-01", vat_amount: 40.004 }),
  ];

  it("treats the window as inclusive on both boundary dates", () => {
    expect(sumInstallmentVat(plans, { dateFrom: "2026-08-01", dateTo: "2026-08-31" })).toBe(50.01);
  });

  it("splits adjacent windows without double counting or losing a halala", () => {
    const july = sumInstallmentVat(plans, { dateFrom: "2026-07-01", dateTo: "2026-07-31" });
    const august = sumInstallmentVat(plans, { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    const september = sumInstallmentVat(plans, { dateFrom: "2026-09-01", dateTo: "2026-09-30" });
    const all = sumInstallmentVat(plans);
    expect(july + august + september).toBeCloseTo(all, 1);
    expect(Math.abs(july + august + september - all)).toBeLessThanOrEqual(0.02);
  });

  it("drops plans with a missing purchase date once a window is set", () => {
    const withNullDate = [...plans, plan({ id: "d5", purchase_date: null, vat_amount: 5 })];
    expect(sumInstallmentVat(withNullDate, { dateFrom: "2026-08-01", dateTo: "2026-08-31" })).toBe(50.01);
    expect(sumInstallmentVat(withNullDate)).toBe(105.02);
  });

  it("scopes by branch and date window together", () => {
    const mixed = [
      plan({ id: "m1", branch_id: BRANCH_A, purchase_date: "2026-08-05", vat_amount: 451.045 }),
      plan({ id: "m2", branch_id: BRANCH_B, purchase_date: "2026-08-05", vat_amount: 100 }),
      plan({ id: "m3", branch_id: BRANCH_A, purchase_date: "2026-09-05", vat_amount: 100 }),
    ];
    expect(
      sumInstallmentVat(mixed, { branchId: BRANCH_A, dateFrom: "2026-08-01", dateTo: "2026-08-31" }),
    ).toBe(451.05);
  });
});

describe("installment VAT tolerance in reconciliation", () => {
  const base = {
    batches: [{ id: "batch-1", reference_number: "BNPL-001", batch_date: "2026-08-05", is_posted: true }],
    expensesVat: 284.55,
    purchasesVat: 0,
  };

  it("ties when the posted leg differs by less than the default 0.02 tolerance", () => {
    const installmentsVat = sumInstallmentVat([plan({ vat_amount: 451.045 })]); // 451.05
    const r = reconcileVatRecoverable({
      ...base,
      lines: [
        ...ledger(284.55, "2026-08-05", "batch-0"),
        ...ledger(451.04, "2026-08-05", "batch-1"),
      ],
      installmentsVat,
    });
    expect(r.difference).toBe(-0.01);
    expect(r.matched).toBe(true);
  });

  it("still ties at exactly the tolerance boundary", () => {
    const r = reconcileVatRecoverable({
      ...base,
      expensesVat: 0,
      lines: ledger(451.02),
      installmentsVat: 451.04,
    });
    expect(r.difference).toBe(-0.02);
    expect(r.matched).toBe(true);
  });

  it("flags a gap one halala beyond the tolerance", () => {
    const r = reconcileVatRecoverable({
      ...base,
      expensesVat: 0,
      lines: ledger(451.01),
      installmentsVat: 451.04,
    });
    expect(r.difference).toBe(-0.03);
    expect(r.matched).toBe(false);
  });

  it("honours a stricter tolerance for zero-drift branches", () => {
    const r = reconcileVatRecoverable({
      ...base,
      expensesVat: 0,
      lines: ledger(451.03),
      installmentsVat: 451.04,
      tolerance: 0,
    });
    expect(r.matched).toBe(false);
  });

  it("does not let per-plan rounding drift mask a whole missing finance-charge leg", () => {
    const installmentsVat = sumInstallmentVat([
      plan({ vat_amount: 3006.95 * 0.15, finance_vat_amount: 22.5 }),
    ]);
    const r = reconcileVatRecoverable({
      ...base,
      expensesVat: 0,
      lines: ledger(451.04), // finance-charge VAT never posted
      installmentsVat,
    });
    expect(r.installmentsVat).toBe(473.54);
    expect(r.matched).toBe(false);
    expect(r.difference).toBeCloseTo(-22.5, 2);
  });

  it("accumulated sub-halala drift across many branches can exceed tolerance and is reported", () => {
    const plans = Array.from({ length: 10 }, (_, i) =>
      plan({ id: `p${i}`, branch_id: i % 2 ? BRANCH_A : BRANCH_B, vat_amount: 10.004 }),
    );
    const r = reconcileVatRecoverable({
      ...base,
      expensesVat: 0,
      lines: ledger(100), // each leg posted rounded down to 10.00
      installmentsVat: sumInstallmentVat(plans), // 100.04
    });
    expect(r.difference).toBe(-0.04);
    expect(r.matched).toBe(false);
  });
});

describe("installment VAT breakdown — rounding transparency", () => {
  it("rounds goods and finance components separately per row and re-rounds the totals", () => {
    const b = breakdownInstallmentVat([
      plan({ id: "p1", vat_amount: 451.045, finance_vat_amount: 22.494 }),
      plan({ id: "p2", vat_amount: 0.004, finance_vat_amount: 0.004 }),
    ]);
    // p2 rounds to zero on both legs and is dropped from the breakdown
    expect(b.rows).toHaveLength(1);
    expect(b.rows.find((r) => r.id === "p1")).toMatchObject({ goodsVat: 451.05, financeVat: 22.49 });
    expect(b.goodsVat).toBe(451.05);
    expect(b.financeVat).toBe(22.49);
    expect(b.totalVat).toBe(473.54);
  });

  it("keeps cancelled plans visible but out of the rounded totals", () => {
    const b = breakdownInstallmentVat([
      plan({ id: "p1", vat_amount: 451.045 }),
      plan({ id: "p2", status: "cancelled", vat_amount: 100.005 }),
    ]);
    expect(b.rows).toHaveLength(2);
    expect(b.totalVat).toBe(451.05);
    expect(b.excludedVat).toBe(100.01);
  });

  it("breakdown total matches sumInstallmentVat within a halala for the same scope", () => {
    const plans = [
      plan({ id: "p1", branch_id: BRANCH_A, purchase_date: "2026-08-02", vat_amount: 10.004 }),
      plan({ id: "p2", branch_id: BRANCH_A, purchase_date: "2026-08-20", vat_amount: 20.006, finance_vat_amount: 1.004 }),
      plan({ id: "p3", branch_id: BRANCH_B, purchase_date: "2026-08-20", vat_amount: 99 }),
      plan({ id: "p4", branch_id: BRANCH_A, purchase_date: "2026-09-02", vat_amount: 99 }),
    ];
    const scope = { branchId: BRANCH_A, dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    const diff = Math.abs(breakdownInstallmentVat(plans, scope).totalVat - sumInstallmentVat(plans, scope));
    expect(diff).toBeLessThanOrEqual(0.01);
  });
});
