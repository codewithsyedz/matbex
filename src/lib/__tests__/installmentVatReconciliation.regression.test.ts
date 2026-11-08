import { describe, it, expect } from "vitest";
import {
  reconcileVatRecoverable,
  sumInstallmentVat,
  type InstallmentVatPlan,
} from "@/lib/vatRecoverableReconciliation";

/**
 * Regression guard for the "phantom VAT recoverable gap" defect.
 *
 * Installment (BNPL) purchases debit input VAT (1180) straight to the ledger
 * without producing an expense or purchase-invoice row. Before the fix the
 * reconciliation panel only summed expenses + purchase invoices, so the
 * refrigerator plan (goods VAT 451.04) surfaced as an unexplained ledger-only
 * difference of exactly that amount.
 *
 * These tests pin: (1) installment VAT is counted on the source side,
 * (2) it is scoped correctly by branch and by date, and (3) cancelled plans
 * never inflate the source total.
 */

const BR_WADI = "branch-al-wadi";
const BR_MALAZ = "branch-al-malaz";

const plans: InstallmentVatPlan[] = [
  // The real refrigerator plan — Al-Wadi, 5 Aug.
  {
    vat_amount: 451.04,
    finance_vat_amount: 0,
    status: "active",
    branch_id: BR_WADI,
    purchase_date: "2026-08-05",
  },
  // Financed plan with VAT on the finance charge — Al-Malaz, 12 Aug.
  {
    vat_amount: 300,
    finance_vat_amount: 21.3,
    status: "active",
    branch_id: BR_MALAZ,
    purchase_date: "2026-08-12",
  },
  // Cancelled — legs reversed, must never count.
  {
    vat_amount: 999.99,
    finance_vat_amount: 12,
    status: "cancelled",
    branch_id: BR_WADI,
    purchase_date: "2026-08-06",
  },
  // Outside the August window.
  {
    vat_amount: 75,
    finance_vat_amount: 0,
    status: "active",
    branch_id: BR_WADI,
    purchase_date: "2026-07-31",
  },
];

const AUG = { dateFrom: "2026-08-01", dateTo: "2026-08-31" };

describe("installment VAT source aggregation", () => {
  it("counts goods VAT plus finance-charge VAT tenant-wide", () => {
    expect(sumInstallmentVat(plans, AUG)).toBe(772.34);
  });

  it("scopes to a single branch", () => {
    expect(sumInstallmentVat(plans, { ...AUG, branchId: BR_WADI })).toBe(451.04);
    expect(sumInstallmentVat(plans, { ...AUG, branchId: BR_MALAZ })).toBe(321.3);
  });

  it("branch slices sum back to the tenant-wide total", () => {
    const all = sumInstallmentVat(plans, AUG);
    const parts = [BR_WADI, BR_MALAZ].map((b) =>
      sumInstallmentVat(plans, { ...AUG, branchId: b }),
    );
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(all);
  });

  it("excludes cancelled plans regardless of casing", () => {
    const withCancelled = sumInstallmentVat(
      [...plans, { vat_amount: 500, status: "CANCELLED", purchase_date: "2026-08-09" }],
      AUG,
    );
    expect(withCancelled).toBe(772.34);
  });

  it("respects the date window boundaries inclusively", () => {
    expect(sumInstallmentVat(plans, { dateFrom: "2026-08-05", dateTo: "2026-08-05" })).toBe(451.04);
    expect(sumInstallmentVat(plans, { dateFrom: "2026-07-01", dateTo: "2026-07-31" })).toBe(75);
    expect(sumInstallmentVat(plans, { dateFrom: "2026-09-01", dateTo: "2026-09-30" })).toBe(0);
  });

  it("treats missing/undated plans as outside any window", () => {
    expect(sumInstallmentVat([{ vat_amount: 40 }], AUG)).toBe(0);
    expect(sumInstallmentVat([{ vat_amount: 40 }])).toBe(40);
  });
});

describe("reconciliation ties once installment VAT is a source document", () => {
  const batches = [
    { id: "b-exp", reference_number: "EXP-77", journal_type: "expense", batch_date: "2026-08-03", is_posted: true },
    { id: "b-inst", reference_number: "INST-1", journal_type: "purchase", batch_date: "2026-08-05", is_posted: true },
  ];

  it("reproduces the 451.04 gap when installment VAT is ignored", () => {
    const r = reconcileVatRecoverable({
      lines: [
        { batch_id: "b-exp", debit: 284.55, credit: 0 },
        { batch_id: "b-inst", debit: 451.04, credit: 0 },
      ],
      batches,
      expensesVat: 284.55,
      purchasesVat: 0,
    });
    expect(r.ledgerTotal).toBe(735.59);
    expect(r.sourceTotal).toBe(284.55);
    expect(r.difference).toBe(451.04);
    expect(r.matched).toBe(false);
  });

  it("ties for Al-Wadi once installment VAT is included", () => {
    const r = reconcileVatRecoverable({
      lines: [
        { batch_id: "b-exp", debit: 284.55, credit: 0 },
        { batch_id: "b-inst", debit: 451.04, credit: 0 },
      ],
      batches,
      expensesVat: 284.55,
      purchasesVat: 0,
      installmentsVat: sumInstallmentVat(plans, { ...AUG, branchId: BR_WADI }),
    });
    expect(r.installmentsVat).toBe(451.04);
    expect(r.sourceTotal).toBe(735.59);
    expect(r.difference).toBe(0);
    expect(r.matched).toBe(true);
  });

  it("ties for Al-Malaz including finance-charge VAT", () => {
    const r = reconcileVatRecoverable({
      lines: [{ batch_id: "b-inst", debit: 321.3, credit: 0 }],
      batches,
      expensesVat: 0,
      purchasesVat: 0,
      installmentsVat: sumInstallmentVat(plans, { ...AUG, branchId: BR_MALAZ }),
    });
    expect(r.matched).toBe(true);
    expect(r.sourceTotal).toBe(321.3);
  });

  it("ties tenant-wide across both branches", () => {
    const r = reconcileVatRecoverable({
      lines: [
        { batch_id: "b-exp", debit: 284.55, credit: 0 },
        { batch_id: "b-inst", debit: 451.04, credit: 0 },
        { batch_id: "b-inst", debit: 321.3, credit: 0 },
      ],
      batches,
      expensesVat: 284.55,
      purchasesVat: 0,
      installmentsVat: sumInstallmentVat(plans, AUG),
    });
    expect(r.ledgerTotal).toBe(1056.89);
    expect(r.matched).toBe(true);
  });

  it("a cancelled plan whose legs were reversed still ties", () => {
    const r = reconcileVatRecoverable({
      lines: [
        { batch_id: "b-inst", debit: 451.04, credit: 0 },
        { batch_id: "b-inst", debit: 0, credit: 451.04 },
      ],
      batches,
      expensesVat: 0,
      purchasesVat: 0,
      installmentsVat: sumInstallmentVat(
        [{ vat_amount: 451.04, status: "cancelled", branch_id: BR_WADI, purchase_date: "2026-08-05" }],
        { ...AUG, branchId: BR_WADI },
      ),
    });
    expect(r.ledgerTotal).toBe(0);
    expect(r.installmentsVat).toBe(0);
    expect(r.matched).toBe(true);
  });

  it("flags a genuine gap when the installment ledger leg was never posted", () => {
    const r = reconcileVatRecoverable({
      lines: [{ batch_id: "b-exp", debit: 284.55, credit: 0 }],
      batches,
      expensesVat: 284.55,
      purchasesVat: 0,
      installmentsVat: sumInstallmentVat(plans, { ...AUG, branchId: BR_WADI }),
    });
    expect(r.difference).toBe(-451.04);
    expect(r.matched).toBe(false);
  });

  it("does not leak another branch's installment VAT into a branch view", () => {
    const r = reconcileVatRecoverable({
      lines: [{ batch_id: "b-inst", debit: 451.04, credit: 0 }],
      batches,
      expensesVat: 0,
      purchasesVat: 0,
      installmentsVat: sumInstallmentVat(plans, AUG), // wrong: tenant-wide in a branch view
    });
    expect(r.matched).toBe(false);
    expect(r.difference).toBe(-321.3);
  });
});