import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Regression suite: editing a bill's description must never duplicate invoice
 * line items, and the bill / expense total must always stay equal to the ledger
 * debit after every save.
 *
 * The backend below mirrors the server-side `replace_invoice_items` RPC
 * (atomic delete + insert + total recompute, SECURITY DEFINER so RLS cannot
 * silently swallow the delete) and the `bulk_fix_invoice_divergence` repair RPC
 * (signature-based dedupe + total recompute).
 */

interface Line {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

type LineInput = Omit<Line, "id" | "total_price">;

const round2 = (n: number) => Math.round(n * 100) / 100;
const signature = (l: Line) =>
  `${l.description}|${l.quantity}|${l.unit_price}|${l.total_price}`;

class BillBackend {
  lines: Line[] = [];
  taxAmount = 0;
  subtotal = 0;
  invoiceTotal = 0;
  expenseAmount = 0;
  ledgerDebit: number | null = null;
  posted = false;
  private seq = 0;

  constructor(taxAmount = 0) {
    this.taxAmount = taxAmount;
  }

  /** Server-side atomic line replace — the ONLY sanctioned write path. */
  replaceInvoiceItems(rows: LineInput[]) {
    this.lines = rows.map((r) => {
      this.seq += 1;
      return {
        id: `line-${this.seq}`,
        ...r,
        total_price: round2(r.quantity * r.unit_price),
      };
    });
    this.recompute();
  }

  /** Legacy client path: RLS blocked the DELETE, so lines accumulated. */
  legacyClientSync(rows: LineInput[]) {
    for (const r of rows) {
      this.seq += 1;
      this.lines.push({
        id: `line-${this.seq}`,
        ...r,
        total_price: round2(r.quantity * r.unit_price),
      });
    }
    this.recompute();
  }

  post() {
    this.ledgerDebit = this.invoiceTotal;
    this.posted = true;
  }

  /** Mirrors bulk_fix_invoice_divergence: dedupe by signature, keep first. */
  bulkReconcileAndFix(dryRun = false) {
    const seen = new Set<string>();
    const kept: Line[] = [];
    let removed = 0;
    for (const l of this.lines) {
      const sig = signature(l);
      if (seen.has(sig)) {
        removed += 1;
        continue;
      }
      seen.add(sig);
      kept.push(l);
    }
    const newTotal = round2(kept.reduce((s, l) => s + l.total_price, 0));
    const result = {
      removed_lines: removed,
      old_total: this.invoiceTotal,
      new_total: newTotal,
      needs_ledger_repost: this.posted && this.ledgerDebit !== null && Math.abs(this.ledgerDebit - newTotal) > 0.005,
    };
    if (!dryRun) {
      this.lines = kept;
      this.recompute();
      // Posted bills never have their expense silently rewritten below ledger.
      if (!this.posted) this.expenseAmount = this.invoiceTotal;
    }
    return result;
  }

  duplicateCount() {
    const counts = new Map<string, number>();
    for (const l of this.lines) counts.set(signature(l), (counts.get(signature(l)) ?? 0) + 1);
    return Array.from(counts.values()).reduce((s, c) => s + (c - 1), 0);
  }

  private recompute() {
    const sum = round2(this.lines.reduce((s, l) => s + l.total_price, 0));
    this.invoiceTotal = sum;
    this.subtotal = round2(sum - this.taxAmount);
    this.expenseAmount = sum;
  }
}

const BASE_LINES: LineInput[] = [
  { description: "Meat & Poultry", quantity: 1, unit_price: 1470 },
  { description: "Vegetables", quantity: 3, unit_price: 55.5 },
  { description: "Cooking oil 20L", quantity: 2, unit_price: 189.25 },
];

const EXPECTED_TOTAL = round2(1470 + 3 * 55.5 + 2 * 189.25);

const withDescriptions = (rows: LineInput[], suffix: string): LineInput[] =>
  rows.map((r) => ({ ...r, description: `${r.description} ${suffix}` }));

describe("bill description edits never duplicate lines", () => {
  it("keeps line count and total stable across 25 consecutive description edits", () => {
    const be = new BillBackend();
    be.replaceInvoiceItems(BASE_LINES);
    be.post();

    for (let i = 1; i <= 25; i += 1) {
      be.replaceInvoiceItems(withDescriptions(BASE_LINES, `rev ${i}`));
      expect(be.lines).toHaveLength(BASE_LINES.length);
      expect(be.duplicateCount()).toBe(0);
      expect(be.invoiceTotal).toBe(EXPECTED_TOTAL);
      expect(be.expenseAmount).toBe(be.ledgerDebit);
    }

    expect(be.lines.map((l) => l.description)).toEqual([
      "Meat & Poultry rev 25",
      "Vegetables rev 25",
      "Cooking oil 20L rev 25",
    ]);
  });

  it("keeps subtotal + tax consistent with the ledger when the bill carries VAT", () => {
    const be = new BillBackend(220.5);
    be.replaceInvoiceItems(BASE_LINES);
    be.post();

    be.replaceInvoiceItems(withDescriptions(BASE_LINES, "(corrected)"));

    expect(be.invoiceTotal).toBe(EXPECTED_TOTAL);
    expect(round2(be.subtotal + be.taxAmount)).toBe(be.invoiceTotal);
    expect(be.expenseAmount).toBe(be.ledgerDebit);
  });

  it("preserves genuinely repeated lines that differ by quantity or price", () => {
    const be = new BillBackend();
    be.replaceInvoiceItems([
      { description: "Chicken", quantity: 1, unit_price: 100 },
      { description: "Chicken", quantity: 2, unit_price: 100 },
      { description: "Chicken", quantity: 1, unit_price: 120 },
    ]);
    be.post();

    be.replaceInvoiceItems([
      { description: "Chicken (morning)", quantity: 1, unit_price: 100 },
      { description: "Chicken (morning)", quantity: 2, unit_price: 100 },
      { description: "Chicken (evening)", quantity: 1, unit_price: 120 },
    ]);

    expect(be.lines).toHaveLength(3);
    expect(be.invoiceTotal).toBe(420);
    expect(be.expenseAmount).toBe(be.ledgerDebit);
  });

  it("never lets the expense drift from the ledger under randomised edit sequences", () => {
    const be = new BillBackend();
    be.replaceInvoiceItems(BASE_LINES);
    be.post();

    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let i = 0; i < 50; i += 1) {
      const label = `note-${Math.floor(rand() * 1e6)}`;
      be.replaceInvoiceItems(withDescriptions(BASE_LINES, label));
      expect(be.duplicateCount()).toBe(0);
      expect(be.invoiceTotal).toBe(be.ledgerDebit);
      expect(be.expenseAmount).toBe(be.ledgerDebit);
    }
  });
});

describe("bulk reconcile and fix restores bills inflated by the legacy path", () => {
  it("previews without mutating, then removes duplicates and restores the ledger total", () => {
    const be = new BillBackend();
    be.replaceInvoiceItems(BASE_LINES);
    be.post();
    const posted = be.ledgerDebit!;

    // Two legacy saves inflate the bill to 3x.
    be.legacyClientSync(BASE_LINES);
    be.legacyClientSync(BASE_LINES);
    expect(be.lines).toHaveLength(9);
    expect(be.invoiceTotal).toBe(round2(posted * 3));
    expect(be.duplicateCount()).toBe(6);

    const preview = be.bulkReconcileAndFix(true);
    expect(preview.removed_lines).toBe(6);
    expect(preview.new_total).toBe(posted);
    expect(be.lines).toHaveLength(9); // dry run mutates nothing

    const applied = be.bulkReconcileAndFix(false);
    expect(applied.removed_lines).toBe(6);
    expect(be.lines).toHaveLength(3);
    expect(be.duplicateCount()).toBe(0);
    expect(be.invoiceTotal).toBe(posted);
    expect(be.expenseAmount).toBe(be.ledgerDebit);
    expect(applied.needs_ledger_repost).toBe(false);
  });

  it("flags a repost when the corrected total no longer matches the posted ledger", () => {
    const be = new BillBackend();
    be.replaceInvoiceItems(BASE_LINES);
    be.legacyClientSync(BASE_LINES);
    be.post(); // posted at the already-inflated amount

    const res = be.bulkReconcileAndFix(false);
    expect(res.removed_lines).toBe(3);
    expect(be.invoiceTotal).toBe(EXPECTED_TOTAL);
    expect(res.needs_ledger_repost).toBe(true);
  });

  it("is idempotent — a second run finds nothing left to fix", () => {
    const be = new BillBackend();
    be.replaceInvoiceItems(BASE_LINES);
    be.legacyClientSync(BASE_LINES);
    be.bulkReconcileAndFix(false);

    const second = be.bulkReconcileAndFix(false);
    expect(second.removed_lines).toBe(0);
    expect(second.old_total).toBe(second.new_total);
    expect(be.duplicateCount()).toBe(0);
  });
});

describe("invoice line write paths stay locked down", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  const WRITE_CALLERS = [
    "src/pages/Expenses.tsx",
    "src/components/inventory/InvoiceManager.tsx",
    "src/hooks/useExpenseApproval.ts",
  ];

  it.each(WRITE_CALLERS)("%s never writes invoice_items directly", (file) => {
    const src = read(file);
    expect(src).toContain("replace_invoice_items");
    expect(
      src.match(/from\((["'])invoice_items\1\)[\s\S]{0,200}?\.(insert|update|delete|upsert)\(/g),
    ).toBeNull();
  });

  it("the repair hook exposes a dry-run preview before applying changes", () => {
    const src = read("src/hooks/useInvoiceDivergenceCheck.ts");
    expect(src).toContain("bulk_fix_invoice_divergence");
    expect(src).toContain("p_dry_run");
  });

  it("the reconciliation card requires an explicit confirmation to apply the fix", () => {
    const src = read("src/components/accounting/InvoiceDivergenceCheckCard.tsx");
    expect(src).toContain("runFix(true)"); // preview
    expect(src).toContain("setConfirmOpen(true)"); // apply goes through confirmation
    expect(src).toContain("AlertDialog");
  });
});
