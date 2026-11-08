import { describe, it, expect } from "vitest";
import {
  isInputVatAccount,
  reconcileVatRecoverable,
} from "../vatRecoverableReconciliation";

describe("isInputVatAccount", () => {
  it("matches by code and by name", () => {
    expect(isInputVatAccount("1180", "Whatever")).toBe(true);
    expect(isInputVatAccount("1182", null)).toBe(true);
    expect(isInputVatAccount("6100", "Input VAT Recoverable")).toBe(true);
    expect(isInputVatAccount("6100", "vat recoverable - branch")).toBe(true);
    expect(isInputVatAccount("2100", "Output VAT Payable")).toBe(false);
  });
});

describe("reconcileVatRecoverable", () => {
  const batches = [
    { id: "b1", reference_number: "EXP-1", journal_type: "expense", batch_date: "2026-06-02", is_posted: true },
    { id: "b2", reference_number: "PUR-9", journal_type: "purchase", batch_date: "2026-06-05", is_posted: true },
  ];

  it("groups VAT legs per batch and matches the source total", () => {
    const r = reconcileVatRecoverable({
      lines: [
        { batch_id: "b1", debit: 15, credit: 0 },
        { batch_id: "b1", debit: 5, credit: 0 },
        { batch_id: "b2", debit: 30, credit: 0 },
      ],
      batches,
      expensesVat: 20,
      purchasesVat: 30,
    });
    expect(r.ledgerTotal).toBe(50);
    expect(r.sourceTotal).toBe(50);
    expect(r.matched).toBe(true);
    expect(r.batches).toHaveLength(2);
    expect(r.batches.find((b) => b.batchId === "b1")).toMatchObject({ vat: 20, lines: 2, reference: "EXP-1" });
    expect(r.batches[0].date).toBe("2026-06-05"); // newest first
  });

  it("flags a dropped VAT split leg", () => {
    const r = reconcileVatRecoverable({
      lines: [{ batch_id: "b1", debit: 15, credit: 0 }],
      batches,
      expensesVat: 20,
      purchasesVat: 0,
    });
    expect(r.difference).toBe(-5);
    expect(r.matched).toBe(false);
  });

  it("ignores voided legs and nets reversals", () => {
    const r = reconcileVatRecoverable({
      lines: [
        { batch_id: "b1", debit: 20, credit: 0 },
        { batch_id: "b1", debit: 0, credit: 20 },
        { batch_id: "b2", debit: 99, credit: 0, is_voided: true },
      ],
      batches,
      expensesVat: 0,
      purchasesVat: 0,
    });
    expect(r.ledgerTotal).toBe(0);
    expect(r.matched).toBe(true);
    expect(r.batches).toHaveLength(1);
  });

  it("reports VAT posted without a journal batch", () => {
    const r = reconcileVatRecoverable({
      lines: [{ batch_id: null, debit: 7.5, credit: 0, transaction_date: "2026-06-01" }],
      batches,
      expensesVat: 7.5,
      purchasesVat: 0,
    });
    expect(r.unbatchedVat).toBe(7.5);
    expect(r.batches).toHaveLength(0);
    expect(r.matched).toBe(true);
  });

  it("tolerates sub-cent rounding", () => {
    const r = reconcileVatRecoverable({
      lines: [{ batch_id: "b1", debit: 33.335, credit: 0 }],
      batches,
      expensesVat: 33.33,
      purchasesVat: 0,
    });
    expect(r.matched).toBe(true);
  });
});
