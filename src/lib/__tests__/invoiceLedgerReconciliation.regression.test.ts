/**
 * Regression guard for the Invoice Ledger Reconciliation rules.
 *
 * Two historical false alerts must never reappear:
 *  1. VAT-only alerts — comparing line items against the gross total instead of
 *     the subtotal flagged every 15% VAT bill as "Total ≠ lines".
 *  2. Duplicate repairs — legitimate repeat purchases of the same item on
 *     different days were flagged (and bulk-repaired) as duplicated lines.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  buildLineGroups,
  evaluateInvoiceReconciliation,
  isSuspectedDuplicate,
} from "@/lib/invoiceReconciliation";

const line = (
  description: string,
  quantity: number,
  unitPrice: number,
  createdAt: string,
) => ({
  description,
  quantity,
  unit_price: unitPrice,
  total_price: Math.round(quantity * unitPrice * 100) / 100,
  created_at: createdAt,
});

describe("VAT-only false alerts", () => {
  it("does not flag a 15% VAT bill whose lines equal the subtotal", () => {
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 724.5, subtotal: 630, tax_amount: 94.5 },
      lines: [line("Chicken", 30, 21, "2026-06-03T14:28:00Z")],
      expenseAmount: 724.5,
      ledgerDebit: 724.5,
      ledgerLegCount: 2,
    });
    expect(r.issues).toEqual([]);
    expect(r.worstIssue).toBe("ok");
  });

  it("derives the subtotal from total - tax when subtotal is null", () => {
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 115, subtotal: null, tax_amount: 15 },
      lines: [line("Rice", 10, 10, "2026-06-04T08:00:00Z")],
      expenseAmount: 115,
      ledgerDebit: 115,
      ledgerLegCount: 2,
    });
    expect(r.invoiceSubtotal).toBe(100);
    expect(r.issues).not.toContain("total_mismatch");
  });

  it("still flags a genuine total mismatch on a VAT bill", () => {
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 724.5, subtotal: 630, tax_amount: 94.5 },
      lines: [line("Chicken", 20, 21, "2026-06-03T14:28:00Z")], // 420 ≠ 630
      expenseAmount: 724.5,
      ledgerDebit: 724.5,
      ledgerLegCount: 2,
    });
    expect(r.issues).toContain("total_mismatch");
  });

  it("compares expense and ledger against the gross total, not the subtotal", () => {
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 724.5, subtotal: 630, tax_amount: 94.5 },
      lines: [line("Chicken", 30, 21, "2026-06-03T14:28:00Z")],
      expenseAmount: 630,
      ledgerDebit: 630,
      ledgerLegCount: 2,
    });
    expect(r.issues).toContain("expense_mismatch");
    expect(r.issues).toContain("ledger_mismatch");
  });
});

describe("duplicate-line detection", () => {
  it("flags identical lines written at the same millisecond", () => {
    const at = "2026-06-24T10:15:30.500Z";
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 680, subtotal: 680, tax_amount: 0 },
      lines: [line("Meat", 1, 340, at), line("Meat", 1, 340, at)],
      expenseAmount: 680,
      ledgerDebit: 680,
      ledgerLegCount: 2,
    });
    expect(r.issues).toContain("duplicate_lines");
    expect(r.duplicateLineCount).toBe(1);
    expect(r.duplicateAmount).toBe(340);
    expect(r.dedupSum).toBe(340);
  });

  it("does not flag the same item legitimately purchased on different days", () => {
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 680, subtotal: 680, tax_amount: 0 },
      lines: [
        line("Meat", 1, 340, "2026-06-20T09:00:00Z"),
        line("Meat", 1, 340, "2026-06-24T09:00:00Z"),
      ],
      expenseAmount: 680,
      ledgerDebit: 680,
      ledgerLegCount: 2,
    });
    expect(r.issues).toEqual([]);
    expect(r.duplicateLineCount).toBe(0);
    expect(r.duplicateAmount).toBe(0);
    expect(r.dedupSum).toBe(680);
  });

  it("does not flag repeats a second apart within the same edit session", () => {
    const groups = buildLineGroups([
      line("Oil", 2, 55, "2026-07-01T10:00:00.000Z"),
      line("Oil", 2, 55, "2026-07-01T10:00:01.000Z"),
    ]);
    expect(groups.some(isSuspectedDuplicate)).toBe(false);
  });

  it("treats lines with an unparsable timestamp as non-duplicates", () => {
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 200, subtotal: 200, tax_amount: 0 },
      lines: [
        { description: "Legacy", quantity: 1, unit_price: 100, total_price: 100, created_at: null },
        { description: "Legacy", quantity: 1, unit_price: 100, total_price: 100, created_at: null },
      ],
    });
    expect(r.duplicateLineCount).toBe(0);
    expect(r.issues).not.toContain("duplicate_lines");
  });

  it("keeps three same-timestamp copies as two duplicates", () => {
    const at = "2026-06-24T10:15:30.500Z";
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 1020, subtotal: 1020, tax_amount: 0 },
      lines: [line("Meat", 1, 340, at), line("Meat", 1, 340, at), line("Meat", 1, 340, at)],
    });
    expect(r.duplicateLineCount).toBe(2);
    expect(r.duplicateAmount).toBe(680);
  });
});

describe("posting state rules", () => {
  it("flags an expense with no ledger legs as not posted", () => {
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 142, subtotal: 142, tax_amount: 0 },
      lines: [line("Gas", 1, 142, "2026-06-10T09:00:00Z")],
      expenseAmount: 142,
      hasExpense: true,
      ledgerDebit: null,
      ledgerLegCount: 0,
    });
    expect(r.issues).toContain("not_posted");
    expect(r.issues).not.toContain("ledger_mismatch");
  });

  it("leaves an unlinked bill unflagged when lines match the subtotal", () => {
    const r = evaluateInvoiceReconciliation({
      invoice: { total_amount: 115, subtotal: 100, tax_amount: 15 },
      lines: [line("Spices", 1, 100, "2026-06-11T09:00:00Z")],
    });
    expect(r.issues).toEqual([]);
  });
});

describe("SQL contract: divergence detectors stay VAT-aware", () => {
  const MIGRATIONS = path.resolve(process.cwd(), "supabase/migrations");

  const latestDefinition = (fnName: string): string | null => {
    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    let latest: string | null = null;
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
      const re = new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${fnName}\\b[\\s\\S]*?\\$(?:function)?\\$[\\s\\S]*?\\$(?:function)?\\$`,
        "gi",
      );
      const matches = sql.match(re);
      if (matches?.length) latest = matches[matches.length - 1];
    }
    return latest;
  };

  for (const fn of [
    "detect_invoice_ledger_divergence",
    "detect_invoice_ledger_divergence_for_tenant",
  ]) {
    it(`${fn} compares lines against the subtotal, not the gross total`, () => {
      const def = latestDefinition(fn);
      expect(def, `${fn} definition found in migrations`).toBeTruthy();
      const body = (def ?? "").toLowerCase();
      expect(body).toContain("subtotal");
      expect(body).toMatch(/tax_amount/);
    });
  }

  it("bulk_fix_invoice_divergence writes an audit log for every applied repair", () => {
    const def = latestDefinition("bulk_fix_invoice_divergence");
    expect(def, "bulk_fix_invoice_divergence definition found").toBeTruthy();
    const body = (def ?? "").toLowerCase();
    expect(body).toContain("insert into public.audit_logs");
    expect(body).toContain("bulk_invoice_reconcile_fix");
    // Dry runs must never mutate invoice lines.
    expect(body).toMatch(/if\s+not\s+p_dry_run/);
  });
});