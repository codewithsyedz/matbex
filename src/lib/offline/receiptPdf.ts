// =====================================================================
// Offline receipt PDF generator
// ---------------------------------------------------------------------
// Renders an 80mm-style thermal receipt as a PDF using jsPDF, working
// 100% client-side so it can be produced even when offline. Sensitive
// fields (customer phone/email/notes) are decrypted from the offline
// AES-GCM store before being placed on the page.
//
// The output also embeds a "PROVISIONAL - NOT YET SYNCED" stamp when
// the underlying invoice has not been confirmed by the server, so the
// physical copy is unambiguous.
// =====================================================================

import jsPDF from "jspdf";
import { format } from "date-fns";
import { getAll, STORES } from "./db";
import { unprotectPayload } from "./crypto";
import type { OfflineRecord } from "./types";
import { formatMoneyAmount } from "@/lib/vatInclusive";

export interface OfflineReceiptInput {
  restaurantName: string;
  receiptNumber: string;
  date: Date;
  items: { name: string; quantity: number; unit_price: number; total_price: number }[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  cashierName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  isSynced: boolean;
  serverId?: string | null;
  terminalId?: string | null;
  currency?: string;
  /** Resolved pricing branch (same branch the VAT rate came from). */
  branchName?: string | null;
  /** VAT percentage of the resolved branch, e.g. 15 */
  vatRate?: number | null;
  /** Branch pricing mode: true = listed prices already include VAT. */
  pricesVatInclusive?: boolean;
}

const MM = 1; // jsPDF unit is mm
const W = 80 * MM; // 80mm thermal roll width
const PAD = 4 * MM;

function formatMoney(n: number, currency = "﷼"): string {
  return `${currency} ${formatMoneyAmount(n)}`;
}

/**
 * Build a thermal-style PDF Blob for the given receipt. Returned blob
 * may be downloaded, attached, or rendered into an <iframe> for printing.
 */
export function buildReceiptPdf(input: OfflineReceiptInput): Blob {
  // Estimate height up-front so the page fits the roll exactly.
  const lineH = 4 * MM;
  const headerH = 26 * MM;
  const itemRows = input.items.length;
  const footerH = 30 * MM;
  const stampH = input.isSynced ? 0 : 10 * MM;
  const totalH = headerH + itemRows * lineH + footerH + stampH + 10;

  const doc = new jsPDF({ unit: "mm", format: [W, Math.max(totalH, 100)] });
  const currency = input.currency ?? "﷼";
  let y = PAD;

  // ---- Header ---------------------------------------------------------
  doc.setFont("courier", "bold");
  doc.setFontSize(13);
  doc.text(input.restaurantName, W / 2, y, { align: "center" });
  y += 5 * MM;

  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  if (input.branchName) {
    doc.text(`Branch: ${input.branchName}`, W / 2, y, { align: "center" });
    y += 3.5 * MM;
  }
  doc.text(`Receipt: ${input.receiptNumber}`, W / 2, y, { align: "center" });
  y += 3.5 * MM;
  doc.text(format(input.date, "PPP 'at' p"), W / 2, y, { align: "center" });
  y += 3.5 * MM;
  if (input.cashierName) {
    doc.text(`Cashier: ${input.cashierName}`, W / 2, y, { align: "center" });
    y += 3.5 * MM;
  }
  if (input.customerName) {
    doc.text(`Customer: ${input.customerName}`, W / 2, y, { align: "center" });
    y += 3.5 * MM;
  }

  drawDashedDivider(doc, y);
  y += 3 * MM;

  // ---- Items ---------------------------------------------------------
  doc.setFontSize(8);
  for (const it of input.items) {
    const left = `${it.quantity}x ${it.name}`;
    const right = formatMoney(it.total_price, currency);
    // Wrap long names so they don't overflow the right column.
    const wrapped = doc.splitTextToSize(left, W - PAD * 2 - 22 * MM) as string[];
    doc.text(wrapped, PAD, y);
    doc.text(right, W - PAD, y, { align: "right" });
    y += lineH * Math.max(1, wrapped.length);
  }

  drawDashedDivider(doc, y);
  y += 3 * MM;

  // ---- Totals --------------------------------------------------------
  // The printed TOTAL is always the VAT-inclusive amount the guest pays;
  // Subtotal is the net and VAT is shown separately so they reconcile.
  const inclusive = input.pricesVatInclusive !== false;
  totalRow(doc, "Subtotal (excl. VAT)", formatMoney(input.subtotal, currency), y);
  y += lineH;
  if (input.tax > 0) {
    const label =
      input.vatRate != null
        ? `VAT (${Number(input.vatRate)}%${inclusive ? " incl." : ""})`
        : "Tax";
    totalRow(doc, label, formatMoney(input.tax, currency), y);
    y += lineH;
  }
  doc.setFont("courier", "bold");
  doc.setFontSize(10);
  totalRow(doc, "TOTAL (incl. VAT)", formatMoney(input.total, currency), y);
  y += 5 * MM;

  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.text(`Paid by: ${input.paymentMethod.toUpperCase()}`, W / 2, y, { align: "center" });
  y += 5 * MM;

  if (input.customerPhone) {
    doc.text(`Tel: ${input.customerPhone}`, W / 2, y, { align: "center" });
    y += 3.5 * MM;
  }
  if (input.notes) {
    const wrapped = doc.splitTextToSize(`Notes: ${input.notes}`, W - PAD * 2) as string[];
    doc.text(wrapped, W / 2, y, { align: "center" });
    y += lineH * wrapped.length;
  }

  // ---- Sync stamp ----------------------------------------------------
  if (!input.isSynced) {
    y += 2 * MM;
    drawDashedDivider(doc, y);
    y += 4 * MM;
    doc.setFont("courier", "bold");
    doc.setFontSize(9);
    doc.text("PROVISIONAL - NOT YET SYNCED", W / 2, y, { align: "center" });
    y += 4 * MM;
    doc.setFont("courier", "normal");
    doc.setFontSize(7);
    doc.text("Will be reconciled with the server", W / 2, y, { align: "center" });
    y += 3 * MM;
    doc.text("once connectivity is restored.", W / 2, y, { align: "center" });
    y += 4 * MM;
  } else {
    y += 2 * MM;
    drawDashedDivider(doc, y);
    y += 4 * MM;
    doc.setFontSize(7);
    doc.text(`Synced • Server ref ${input.serverId ?? "-"}`, W / 2, y, { align: "center" });
    y += 4 * MM;
  }

  // ---- Footer --------------------------------------------------------
  doc.setFontSize(7);
  doc.text("Thank you for your visit!", W / 2, y, { align: "center" });
  if (input.terminalId) {
    y += 3 * MM;
    doc.text(`Terminal ${input.terminalId.slice(0, 8)}`, W / 2, y, { align: "center" });
  }

  return doc.output("blob");
}

function totalRow(doc: jsPDF, label: string, value: string, y: number) {
  doc.text(label, PAD, y);
  doc.text(value, W - PAD, y, { align: "right" });
}

function drawDashedDivider(doc: jsPDF, y: number) {
  doc.setLineDashPattern([0.6, 0.6], 0);
  doc.setLineWidth(0.2);
  doc.line(PAD, y, W - PAD, y);
  doc.setLineDashPattern([], 0);
}

/**
 * Build a receipt PDF directly from an offline order record. Decrypts
 * the encrypted payload fields on demand. Returns null when the order
 * cannot be located in IndexedDB.
 */
export async function buildReceiptPdfFromLocalId(opts: {
  orderLocalId: string;
  restaurantName: string;
  cashierName?: string | null;
  currency?: string;
}): Promise<{ blob: Blob; filename: string } | null> {
  const orders = await getAll<OfflineRecord<any>>(STORES.orders);
  const rec = orders.find((o) => o.local_id === opts.orderLocalId);
  if (!rec) return null;

  const payload = (await unprotectPayload(rec.payload)) as Record<string, any>;

  const items = Array.isArray(payload.items)
    ? payload.items.map((i: any) => ({
        name: i.name ?? `Item ${String(i.menu_item_id ?? "").slice(0, 6)}`,
        quantity: Number(i.quantity ?? 1),
        unit_price: Number(i.unit_price ?? 0),
        total_price: Number(i.total_price ?? Number(i.unit_price ?? 0) * Number(i.quantity ?? 1)),
      }))
    : [];

  const blob = buildReceiptPdf({
    restaurantName: opts.restaurantName,
    receiptNumber: payload.receipt_number ?? rec.local_id.slice(0, 8),
    date: payload.created_at ? new Date(payload.created_at) : new Date(rec.created_at),
    items,
    subtotal: Number(payload.subtotal ?? 0),
    tax: Number(payload.tax ?? 0),
    total: Number(payload.total ?? 0),
    paymentMethod: String(payload.payment_method ?? "cash"),
    cashierName: opts.cashierName ?? null,
    customerName: payload.customer_name ?? null,
    customerPhone: payload.customer_phone ?? null,
    notes: payload.notes ?? null,
    isSynced: rec.status === "SYNCED",
    serverId: rec.server_id,
    terminalId: rec.terminal_id,
    currency: opts.currency,
    branchName: payload.branch_name ?? null,
    vatRate:
      payload.vat_rate != null
        ? Number(payload.vat_rate) <= 1
          ? Number(payload.vat_rate) * 100
          : Number(payload.vat_rate)
        : null,
    pricesVatInclusive: (payload as { prices_vat_inclusive?: boolean })
      .prices_vat_inclusive !== false,
  });

  const filename = `receipt-${payload.receipt_number ?? rec.local_id.slice(0, 8)}${
    rec.status === "SYNCED" ? "" : "-provisional"
  }.pdf`;

  return { blob, filename };
}

/** Convenience: trigger a browser download of the given blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}