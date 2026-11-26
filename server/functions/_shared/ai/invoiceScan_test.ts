import { test } from "node:test";
import { deepStrictEqual as eq, ok } from "node:assert/strict";
import { checkExtraction, InvoiceExtraction, buildUserText } from "./invoiceScan.ts";

const items = [{ id: "item-1", name: "Chicken breast", unit: "kg" }, { id: "item-2", name: "Tomato", unit: "kg" }];
const suppliers = [{ id: "sup-1", name: "Al Marai", vat_number: "300000000000003" }];

const base = (over: Partial<InvoiceExtraction> = {}): InvoiceExtraction => ({
  is_invoice: true,
  supplier: { name: "Almarai Co.", vat_number: null, matched_supplier_id: null },
  invoice_number: "INV-77",
  invoice_date: "2026-11-10",
  due_date: null,
  currency: "SAR",
  prices_include_vat: false,
  lines: [
    { description: "صدور دجاج", quantity: 10, unit: "kg", unit_price_excl_vat: 20, line_total_excl_vat: 200, vat_rate: 0.15, matched_inventory_item_id: "item-1", match_confidence: "high" },
  ],
  subtotal_excl_vat: 200,
  vat_amount: 30,
  total: 230,
  notes: [],
  ...over,
});

test("a consistent invoice passes with no warnings", () => {
  const d = checkExtraction(base(), items, suppliers);
  eq(d.warnings, []);
  eq(d.lines[0].matched_inventory_item_id, "item-1");
});

test("ids that are not ours are dropped", () => {
  const d = checkExtraction(base({
    supplier: { name: "X", vat_number: null, matched_supplier_id: "someone-else" },
    lines: [{ ...base().lines[0], matched_inventory_item_id: "made-up" }],
  }), items, suppliers);
  eq(d.supplier.matched_supplier_id, null);
  eq(d.lines[0].matched_inventory_item_id, null);
  eq(d.lines[0].match_confidence, "none");
  ok(d.warnings.some((w) => /not linked to a stock item/.test(w)));
});

test("a printed VAT number matches the supplier even when the name differs", () => {
  const d = checkExtraction(base({ supplier: { name: "شركة المراعي", vat_number: "300-000-000-000-003", matched_supplier_id: null } }), items, suppliers);
  eq(d.supplier.matched_supplier_id, "sup-1");
  eq(d.supplier.vat_number, "300000000000003");
});

test("totals that do not add up are flagged", () => {
  const d = checkExtraction(base({ subtotal_excl_vat: 250, total: 300 }), items, suppliers);
  ok(d.warnings.some((w) => /lines add up to 200/.test(w)));
  ok(d.warnings.some((w) => /differs from the printed total/.test(w)));
});

test("bad dates are cleared and flagged", () => {
  const d = checkExtraction(base({ invoice_date: "10/11/2026" }), items, suppliers);
  eq(d.invoice_date, null);
  ok(d.warnings.some((w) => /date could not be read/.test(w)));
});

test("the catalog is sent as id | name lines", () => {
  const t = buildUserText(items, suppliers);
  ok(t.includes("item-1 | Chicken breast | kg"));
  ok(t.includes("sup-1 | Al Marai | VAT 300000000000003"));
});
