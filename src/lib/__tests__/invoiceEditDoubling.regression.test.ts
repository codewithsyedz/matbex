import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Regression: editing only the description of an itemized bill used to double the
 * expense total (1,470 -> 2,940 -> 4,410) because the client-side DELETE on
 * invoice_items was silently blocked by RLS, so each save re-inserted the lines
 * and the total was recomputed from the duplicates. The ledger stayed at 1,470,
 * so bill and ledger diverged.
 *
 * These tests replay two consecutive description edits through a simulated
 * backend and assert the expense total never diverges from the ledger debit.
 */

interface Line {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

class InvoiceBackend {
  lines: Line[] = [];
  invoiceTotal = 0;
  expenseAmount = 0;
  /** Ledger DR for the original posting - written once when the bill is posted. */
  ledgerDebit = 0;
  private seq = 0;

  post(amount: number) {
    this.ledgerDebit = amount;
  }

  private recompute() {
    const sum = this.lines.reduce((s, l) => s + l.total_price, 0);
    this.invoiceTotal = Math.round(sum * 100) / 100;
    this.expenseAmount = this.invoiceTotal;
  }

  private insert(rows: Array<Omit<Line, "id" | "invoice_id" | "total_price">>) {
    for (const r of rows) {
      this.seq += 1;
      this.lines.push({
        id: `line-${this.seq}`,
        invoice_id: "inv-1",
        ...r,
        total_price: Math.round(r.quantity * r.unit_price * 100) / 100,
      });
    }
  }

  /** Current behaviour: atomic server-side replace + total recompute. */
  replaceInvoiceItems(rows: Array<Omit<Line, "id" | "invoice_id" | "total_price">>) {
    this.lines = [];
    this.insert(rows);
    this.recompute();
  }

  /** Legacy buggy path: client DELETE removed 0 rows (blocked by RLS), then re-inserted. */
  legacyClientSync(rows: Array<Omit<Line, "id" | "invoice_id" | "total_price">>) {
    // delete blocked -> no-op
    this.insert(rows);
    this.recompute();
  }
}

const BILL_LINES = [{ description: "Meat & Poultry", quantity: 1, unit_price: 1470 }];

describe("invoice edit doubling regression", () => {
  it("keeps the expense total equal to the ledger after two description edits", () => {
    const be = new InvoiceBackend();
    be.replaceInvoiceItems(BILL_LINES);
    be.post(be.invoiceTotal);

    expect(be.invoiceTotal).toBe(1470);
    expect(be.ledgerDebit).toBe(1470);

    // Edit #1 - description only
    be.replaceInvoiceItems([{ ...BILL_LINES[0], description: "2-Invoices payment" }]);
    expect(be.lines).toHaveLength(1);
    expect(be.expenseAmount).toBe(be.ledgerDebit);

    // Edit #2 - description only again
    be.replaceInvoiceItems([{ ...BILL_LINES[0], description: "2-Invoices payment 1470+1470" }]);
    expect(be.lines).toHaveLength(1);
    expect(be.invoiceTotal).toBe(1470);
    expect(be.expenseAmount).toBe(be.ledgerDebit);
    expect(be.lines[0].description).toBe("2-Invoices payment 1470+1470");
  });

  it("documents the legacy path that doubled the bill away from the ledger", () => {
    const be = new InvoiceBackend();
    be.replaceInvoiceItems(BILL_LINES);
    be.post(be.invoiceTotal);

    be.legacyClientSync([{ ...BILL_LINES[0], description: "edit 1" }]);
    expect(be.invoiceTotal).toBe(2940);

    be.legacyClientSync([{ ...BILL_LINES[0], description: "edit 2" }]);
    expect(be.invoiceTotal).toBe(4410);
    expect(be.invoiceTotal).not.toBe(be.ledgerDebit);
  });

  it("flags duplicated lines the same way the reconciliation report does", () => {
    const be = new InvoiceBackend();
    be.replaceInvoiceItems(BILL_LINES);
    be.post(be.invoiceTotal);
    be.legacyClientSync([{ ...BILL_LINES[0], description: "Meat & Poultry" }]);

    const signatures = new Map<string, number>();
    for (const l of be.lines) {
      const key = `${l.description}|${l.quantity}|${l.unit_price}|${l.total_price}`;
      signatures.set(key, (signatures.get(key) ?? 0) + 1);
    }
    const duplicateCount = Array.from(signatures.values()).reduce((s, c) => s + (c - 1), 0);
    expect(duplicateCount).toBe(1);
    expect(be.invoiceTotal - be.ledgerDebit).toBe(1470);
  });
});

describe("invoice line write call sites", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  const CALLERS = [
    "src/pages/Expenses.tsx",
    "src/components/inventory/InvoiceManager.tsx",
    "src/hooks/useExpenseApproval.ts",
  ];

  it.each(CALLERS)("%s writes invoice lines only through replace_invoice_items", (file) => {
    const src = read(file);
    expect(src).toContain("replace_invoice_items");
    const direct = src.match(
      /from\((["'])invoice_items\1\)[\s\S]{0,200}?\.(insert|update|delete|upsert)\(/g,
    );
    expect(direct).toBeNull();
  });
});
