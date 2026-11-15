/**
 * Reading a supplier invoice with Claude (scan-supplier-invoice): the output schema, the prompt,
 * and the checks applied to the answer. No I/O here; unit-tested in invoiceScan_test.ts.
 *
 * Claude only proposes. Every supplier / stock-item match must be one of the ids we sent; anything
 * else is dropped. Amounts are re-added here and a warning is shown when they do not agree, so the
 * person reviewing the form sees what to check before saving.
 */
import { z } from "zod";

export const MAX_ITEMS_FOR_MATCHING = 600;
export const MAX_SUPPLIERS_FOR_MATCHING = 300;

export interface CatalogItem { id: string; name: string; unit: string | null }
export interface CatalogSupplier { id: string; name: string; vat_number: string | null }

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const;

/** JSON schema for output_config.format (structured outputs). */
export const INVOICE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_invoice", "supplier", "invoice_number", "invoice_date", "due_date", "currency",
    "prices_include_vat", "lines", "subtotal_excl_vat", "vat_amount", "total", "notes"],
  properties: {
    is_invoice: { type: "boolean", description: "false when the image is not a supplier invoice or receipt, or is unreadable" },
    supplier: {
      type: "object",
      additionalProperties: false,
      required: ["name", "vat_number", "matched_supplier_id"],
      properties: {
        name: nullableString,
        vat_number: { ...nullableString, description: "15-digit Saudi VAT number if printed" },
        matched_supplier_id: { ...nullableString, description: "id from the supplier list, only when clearly the same supplier" },
      },
    },
    invoice_number: nullableString,
    invoice_date: { ...nullableString, description: "YYYY-MM-DD (convert Hijri dates to Gregorian)" },
    due_date: { ...nullableString, description: "YYYY-MM-DD" },
    currency: { type: "string", description: "ISO code, usually SAR" },
    prices_include_vat: { type: "boolean", description: "true when the printed line prices already include VAT" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unit", "unit_price_excl_vat", "line_total_excl_vat", "vat_rate",
          "matched_inventory_item_id", "match_confidence"],
        properties: {
          description: { type: "string", description: "as printed (Arabic or English)" },
          quantity: { type: "number" },
          unit: { ...nullableString, description: "kg, box, carton, piece, litre..." },
          unit_price_excl_vat: { type: "number" },
          line_total_excl_vat: { type: "number" },
          vat_rate: { ...nullableNumber, description: "0.15 for 15%, 0 for zero-rated or exempt" },
          matched_inventory_item_id: { ...nullableString, description: "id from the stock item list, only when it is the same product" },
          match_confidence: { type: "string", enum: ["high", "medium", "low", "none"] },
        },
      },
    },
    subtotal_excl_vat: nullableNumber,
    vat_amount: nullableNumber,
    total: { ...nullableNumber, description: "grand total payable, including VAT" },
    notes: { type: "array", items: { type: "string" }, description: "anything the reviewer should check (blurry, handwritten, discount lines...)" },
  },
} as const;

const Line = z.object({
  description: z.string(),
  quantity: z.number(),
  unit: z.string().nullable(),
  unit_price_excl_vat: z.number(),
  line_total_excl_vat: z.number(),
  vat_rate: z.number().nullable(),
  matched_inventory_item_id: z.string().nullable(),
  match_confidence: z.enum(["high", "medium", "low", "none"]),
});
export const InvoiceExtraction = z.object({
  is_invoice: z.boolean(),
  supplier: z.object({ name: z.string().nullable(), vat_number: z.string().nullable(), matched_supplier_id: z.string().nullable() }),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable(),
  due_date: z.string().nullable(),
  currency: z.string(),
  prices_include_vat: z.boolean(),
  lines: z.array(Line),
  subtotal_excl_vat: z.number().nullable(),
  vat_amount: z.number().nullable(),
  total: z.number().nullable(),
  notes: z.array(z.string()),
});
export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;

export const SYSTEM_PROMPT = `You read supplier invoices and receipts for restaurants in Saudi Arabia and turn them into data for the restaurant's purchasing records.

Invoices may be in Arabic, English or both, printed or handwritten, photographed at an angle. Read what is printed; never invent values. When a field is missing or unreadable, use null and say so in notes.

Lines: one entry per product line. Give quantity, the unit as printed, and prices excluding VAT; if the invoice prints VAT-inclusive prices, work out the excluding-VAT price (Saudi standard rate 15%) and set prices_include_vat. Ignore subtotal, VAT and total rows as lines; a discount line is a line with a negative total.

Matching: you get the restaurant's supplier list and stock item list (id, name, unit). Set matched_supplier_id / matched_inventory_item_id only when it is clearly the same supplier or product (same product in Arabic and English counts; a different size or variant does not). Rate each line match high, medium or low; use none with a null id when nothing fits. Never return an id that is not in the lists.

Dates: YYYY-MM-DD in the Gregorian calendar.`;

export function buildUserText(items: CatalogItem[], suppliers: CatalogSupplier[]): string {
  const sup = suppliers.slice(0, MAX_SUPPLIERS_FOR_MATCHING).map((s) => `${s.id} | ${s.name}${s.vat_number ? ` | VAT ${s.vat_number}` : ""}`);
  const inv = items.slice(0, MAX_ITEMS_FOR_MATCHING).map((i) => `${i.id} | ${i.name}${i.unit ? ` | ${i.unit}` : ""}`);
  return [
    "Read the supplier invoice above.",
    "",
    `Suppliers (id | name | VAT):\n${sup.length ? sup.join("\n") : "(none yet)"}`,
    "",
    `Stock items (id | name | unit):\n${inv.length ? inv.join("\n") : "(none yet)"}`,
  ].join("\n");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ScanDraft extends InvoiceExtraction {
  warnings: string[];
}

/** Drop matches that are not ours, normalise dates and add the reviewer's warnings. */
export function checkExtraction(x: InvoiceExtraction, items: CatalogItem[], suppliers: CatalogSupplier[]): ScanDraft {
  const itemIds = new Set(items.map((i) => i.id));
  const supplierIds = new Set(suppliers.map((s) => s.id));
  const warnings = [...x.notes];
  const isoDate = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);

  const supplier = { ...x.supplier };
  if (supplier.matched_supplier_id && !supplierIds.has(supplier.matched_supplier_id)) supplier.matched_supplier_id = null;
  // A printed VAT number that matches a known supplier is a stronger signal than the name.
  const vat = supplier.vat_number?.replace(/\D/g, "") ?? "";
  if (vat.length === 15) {
    const byVat = suppliers.find((s) => s.vat_number?.replace(/\D/g, "") === vat);
    if (byVat) supplier.matched_supplier_id = byVat.id;
    supplier.vat_number = vat;
  } else if (supplier.vat_number) {
    warnings.push(`The supplier VAT number "${supplier.vat_number}" is not 15 digits; check it.`);
    supplier.vat_number = null;
  }

  const lines = x.lines.map((l) => {
    const known = l.matched_inventory_item_id && itemIds.has(l.matched_inventory_item_id);
    return {
      ...l,
      matched_inventory_item_id: known ? l.matched_inventory_item_id : null,
      match_confidence: known ? l.match_confidence : ("none" as const),
      quantity: round2(l.quantity),
      unit_price_excl_vat: round2(l.unit_price_excl_vat),
      line_total_excl_vat: round2(l.line_total_excl_vat),
    };
  });

  for (const l of lines) {
    if (Math.abs(round2(l.quantity * l.unit_price_excl_vat) - l.line_total_excl_vat) > 0.05) {
      warnings.push(`"${l.description}": quantity × price (${round2(l.quantity * l.unit_price_excl_vat)}) differs from the line total (${l.line_total_excl_vat}).`);
    }
  }
  const linesTotal = round2(lines.reduce((s, l) => s + l.line_total_excl_vat, 0));
  if (x.subtotal_excl_vat != null && Math.abs(linesTotal - x.subtotal_excl_vat) > 0.05) {
    warnings.push(`The lines add up to ${linesTotal}, but the invoice subtotal is ${x.subtotal_excl_vat}; a line may be missing or misread.`);
  }
  if (x.subtotal_excl_vat != null && x.vat_amount != null && x.total != null &&
      Math.abs(round2(x.subtotal_excl_vat + x.vat_amount) - x.total) > 0.05) {
    warnings.push(`Subtotal + VAT (${round2(x.subtotal_excl_vat + x.vat_amount)}) differs from the printed total (${x.total}).`);
  }
  if (x.currency && x.currency.toUpperCase() !== "SAR") warnings.push(`The invoice is in ${x.currency}; amounts are entered as SAR.`);
  const unmatched = lines.filter((l) => !l.matched_inventory_item_id).length;
  if (unmatched) warnings.push(`${unmatched} line${unmatched > 1 ? "s are" : " is"} not linked to a stock item: choose one, or leave it as a non-stock purchase.`);
  if (!isoDate(x.invoice_date)) warnings.push("The invoice date could not be read; enter it.");

  return {
    ...x,
    supplier,
    invoice_date: isoDate(x.invoice_date),
    due_date: isoDate(x.due_date),
    lines,
    warnings: [...new Set(warnings)],
  };
}
