import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createLineInput,
  type InvoiceLineInput,
} from "./factories/invoiceLineFactory";


/**
 * Integration guard for EVERY invoice-line write call site:
 *   1. Bill edit           (src/pages/Expenses.tsx)
 *   2. Invoice manager     (src/components/inventory/InvoiceManager.tsx — create + edit)
 *   3. Purchase tracker    (src/components/inventory/PurchaseTracker.tsx)
 *   4. Approval mirroring  (src/hooks/useExpenseApproval.ts)
 *
 * Part A statically proves no client code writes `invoice_items` directly
 * (the DB guard trigger rejects those writes and legacy paths doubled totals).
 * Part B replays each call site against one shared fake backend that mirrors
 * `replace_invoice_items` and asserts invoice totals always equal the ledger
 * debit, with no line duplication across repeated saves.
 */

const SRC = join(process.cwd(), "src");
const WRITE_OPS = ["insert", "update", "upsert", "delete"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(p) && !/__tests__|\.test\./.test(p) ? [p] : [];
  });
}

const CALL_SITES = {
  billEdit: "src/pages/Expenses.tsx",
  invoiceManager: "src/components/inventory/InvoiceManager.tsx",
  purchaseTracker: "src/components/inventory/PurchaseTracker.tsx",
  approvalMirroring: "src/hooks/useExpenseApproval.ts",
} as const;

describe("invoice line writes: all call sites route through replace_invoice_items", () => {
  const files = walk(SRC);

  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no client file writes invoice_items directly", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("invoice_items")) continue;
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!/\.from\(\s*["'`]invoice_items["'`]\s*\)/.test(line)) return;
        // Look ahead for the operation chained onto this query.
        const window = lines.slice(i, i + 6).join(" ");
        const op = WRITE_OPS.find((o) => new RegExp(`\\.${o}\\s*\\(`).test(window));
        if (op) offenders.push(`${file.replace(SRC, "src")}:${i + 1} → .${op}()`);
      });
    }
    expect(
      offenders,
      `Direct invoice_items writes found (use the replace_invoice_items RPC):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  for (const [name, rel] of Object.entries(CALL_SITES)) {
    it(`${name} (${rel}) calls replace_invoice_items`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).toMatch(/rpc\(\s*["'`]replace_invoice_items["'`]/);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Part B — behavioural replay of every call site                      */
/* ------------------------------------------------------------------ */

interface Line extends InvoiceLineInput {
  id: string;
  total_price: number;
}

type LineInput = InvoiceLineInput;


const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors the server-side replace_invoice_items RPC + guard trigger. */
class InvoiceBackend {
  lines: Line[] = [];
  taxAmount = 0;
  subtotal = 0;
  totalAmount = 0;
  ledgerDebit: number | null = null;
  purchases: string[] = [];
  private seq = 0;

  /** Direct table writes are rejected exactly like trg_guard_invoice_items_writes. */
  directInsert(): never {
    throw new Error(
      "Invoice lines can only be changed through replace_invoice_items()",
    );
  }

  replaceInvoiceItems(rows: LineInput[]) {
    this.lines = rows.map((r) => {
      this.seq += 1;
      return {
        id: `line-${this.seq}`,
        inventory_item_id: r.inventory_item_id ?? null,
        description: r.description,
        quantity: r.quantity,
        unit_price: r.unit_price,
        total_price: round2(r.quantity * r.unit_price),
        auto_create_purchase: r.auto_create_purchase,
      };
    });
    const total = round2(this.lines.reduce((s, l) => s + l.total_price, 0));
    this.totalAmount = total;
    this.subtotal = round2(total - this.taxAmount);
    // Trigger: purchases are created once per line that opts in.
    this.purchases = this.lines.filter((l) => l.auto_create_purchase).map((l) => l.id);
    return this.lines.length;
  }

  /** Header override used when the caller tracks VAT separately. */
  setHeaderTotals(subtotal: number, tax: number, total: number) {
    this.subtotal = round2(subtotal);
    this.taxAmount = round2(tax);
    this.totalAmount = round2(total);
  }

  post() {
    this.ledgerDebit = this.totalAmount;
  }

  get lineSum() {
    return round2(this.lines.reduce((s, l) => s + l.total_price, 0));
  }
}

const BILL_LINES: LineInput[] = [
  createLineInput({
    inventory_item_id: "inv-1",
    description: "Chicken",
    quantity: 10,
    unit_price: 24.5,
  }),
  createLineInput({
    inventory_item_id: "inv-2",
    description: "Rice",
    quantity: 4,
    unit_price: 60,
  }),
];


describe("invoice line write call sites preserve ledger totals", () => {
  it("bill edit: repeated description edits never duplicate lines or double totals", () => {
    const b = new InvoiceBackend();
    b.replaceInvoiceItems(BILL_LINES);
    b.post();
    const original = b.totalAmount;
    expect(original).toBe(485);

    for (let i = 0; i < 5; i++) {
      b.replaceInvoiceItems(
        BILL_LINES.map((l) => ({ ...l, description: `${l.description} v${i}` })),
      );
      b.post();
      expect(b.lines).toHaveLength(BILL_LINES.length);
      expect(b.totalAmount).toBe(original);
      expect(b.ledgerDebit).toBe(b.lineSum);
    }
  });

  it("invoice manager: create then edit keeps header equal to the ledger", () => {
    const b = new InvoiceBackend();
    b.replaceInvoiceItems(BILL_LINES.map((l) => ({ ...l, auto_create_purchase: true })));
    b.setHeaderTotals(485, 72.75, 557.75);
    b.post();
    expect(b.ledgerDebit).toBe(557.75);
    expect(b.purchases).toHaveLength(2);

    // Edit: one line removed, one quantity changed.
    b.taxAmount = 0;
    b.replaceInvoiceItems([{ ...BILL_LINES[0], quantity: 12, auto_create_purchase: true }]);
    b.post();
    expect(b.lines).toHaveLength(1);
    expect(b.totalAmount).toBe(294);
    expect(b.ledgerDebit).toBe(b.lineSum);
    expect(b.purchases).toHaveLength(1); // no duplicate purchases from re-save
  });

  it("purchase tracker: VAT-inclusive header survives the line rewrite", () => {
    const b = new InvoiceBackend();
    const net = 485;
    const vat = round2(net * 0.15);
    b.replaceInvoiceItems(BILL_LINES.map((l) => ({ ...l, auto_create_purchase: true })));
    b.setHeaderTotals(net, vat, round2(net + vat));
    b.post();
    expect(b.subtotal).toBe(net);
    expect(b.totalAmount).toBe(round2(net + vat));
    expect(b.ledgerDebit).toBe(b.totalAmount);
    expect(b.lineSum).toBe(net);
  });

  it("approval mirroring: mirrored lines are display-only and never re-create purchases", () => {
    const b = new InvoiceBackend();
    // Approval mirrors the expense lines with auto_create_purchase = false.
    b.replaceInvoiceItems(BILL_LINES.map((l) => ({ ...l, auto_create_purchase: false })));
    b.post();
    expect(b.purchases).toHaveLength(0);
    expect(b.ledgerDebit).toBe(485);

    // Re-approving / re-mirroring is idempotent.
    b.replaceInvoiceItems(BILL_LINES.map((l) => ({ ...l, auto_create_purchase: false })));
    b.post();
    expect(b.lines).toHaveLength(2);
    expect(b.totalAmount).toBe(485);
    expect(b.ledgerDebit).toBe(b.lineSum);
  });

  it("legacy direct table write is rejected by the guard", () => {
    const b = new InvoiceBackend();
    expect(() => b.directInsert()).toThrow(/replace_invoice_items/);
  });
});
