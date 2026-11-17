import { format } from "date-fns";
import QRCode from "qrcode";
import { generateZatcaQrBase64 } from "@/lib/zatca/tlv";

/** Matbex's own tax invoice for a subscription payment (from subscription-invoice / admin-billing). */
export interface SubscriptionInvoiceDoc {
  invoice_number: string;
  issued_at: string;
  period_start: string | null;
  period_end: string | null;
  seller: { name: string; vat_number: string | null; cr_number: string | null; address: string | null };
  seller_incomplete: boolean;
  buyer: { name: string; vat_number: string | null };
  lines: { description: string; amount: number }[];
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  refunded_amount?: number;
  currency: string;
  method?: string;
  payment_reference: string | null;
}

/** A credit note for a refund of one of those payments. */
export interface SubscriptionCreditNoteDoc {
  credit_note_number: string;
  issued_at: string;
  original_invoice_number: string | null;
  original_issued_at: string | null;
  reason: string;
  seller: SubscriptionInvoiceDoc["seller"];
  seller_incomplete: boolean;
  buyer: SubscriptionInvoiceDoc["buyer"];
  lines: { description: string; amount: number }[];
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  currency: string;
  method: string;
  refund_reference: string | null;
  ended_period: boolean;
}

const sar = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const when = (d: string) => format(new Date(d), "d MMM yyyy, HH:mm");
const METHOD: Record<string, string> = {
  moyasar: "Paid online", bank_transfer: "Paid by bank transfer", cash: "Paid in cash", other: "Paid",
};

const STYLE = `body{font-family:system-ui,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0}
.muted{color:#555;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}
th:last-child,td:last-child{text-align:right}.tot td{border:0;padding:4px 8px}.grid{display:flex;justify-content:space-between;gap:24px;margin-top:16px}
.warn{background:#fdf3d7;padding:8px;border-radius:6px;font-size:13px;margin-top:12px}.ref{background:#f3f4f6;padding:8px 10px;border-radius:6px;font-size:13px;margin-top:12px}
@media print{.noprint{display:none}}`;

async function qr(sellerName: string, vat: string | null, issued: string, total: number, vatTotal: number) {
  return QRCode.toDataURL(generateZatcaQrBase64({
    sellerName,
    vatNumber: vat ?? "",
    timestamp: new Date(issued).toISOString(),
    invoiceTotal: total.toFixed(2),
    vatTotal: vatTotal.toFixed(2),
  }), { margin: 1, width: 180 });
}

function parties(d: { seller: SubscriptionInvoiceDoc["seller"]; buyer: SubscriptionInvoiceDoc["buyer"]; seller_incomplete: boolean }) {
  return `${d.seller_incomplete ? '<p class="warn">Seller details are incomplete (legal name, VAT number or address).</p>' : ""}
<div class="grid"><div><b>Seller</b><br>${esc(d.seller.name)}<br>${d.seller.vat_number ? `VAT ${esc(d.seller.vat_number)}<br>` : ""}${d.seller.cr_number ? `CR ${esc(d.seller.cr_number)}<br>` : ""}${esc(d.seller.address)}</div>
<div><b>Buyer</b><br>${esc(d.buyer.name)}<br>${d.buyer.vat_number ? `VAT ${esc(d.buyer.vat_number)}` : ""}</div></div>`;
}

function open(title: string, body: string) {
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) throw new Error("Allow pop-ups to open the document");
  w.document.write(`<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>
${body}
<p class="noprint"><button onclick="window.print()">Print / Save as PDF</button></p></body></html>`);
  w.document.close();
}

/** Opens the tax invoice in a printable window (with its ZATCA QR code). */
export async function printSubscriptionInvoice(inv: SubscriptionInvoiceDoc) {
  const code = await qr(inv.seller.name, inv.seller.vat_number, inv.issued_at, inv.total, inv.vat_amount);
  open(inv.invoice_number, `<div class="grid"><div><h1>Tax Invoice · فاتورة ضريبية</h1><p class="muted">${esc(inv.invoice_number)} · ${esc(when(inv.issued_at))}</p></div>
<img src="${code}" alt="ZATCA QR" width="120" height="120"></div>
${parties(inv)}
<table><thead><tr><th>Description</th><th>Amount (SAR, excl. VAT)</th></tr></thead><tbody>
${inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${sar(l.amount)}</td></tr>`).join("")}</tbody></table>
<table class="tot"><tr><td>Subtotal</td><td>${sar(inv.subtotal)}</td></tr><tr><td>VAT ${(inv.vat_rate * 100).toFixed(0)}%</td><td>${sar(inv.vat_amount)}</td></tr>
<tr><td><b>Total paid</b></td><td><b>SAR ${sar(inv.total)}</b></td></tr></table>
${inv.refunded_amount ? `<p class="ref">SAR ${sar(inv.refunded_amount)} of this invoice has been refunded; see the credit note(s).</p>` : ""}
<p class="muted">${inv.period_start ? `Service period ${esc(String(inv.period_start).slice(0, 10))} – ${esc(String(inv.period_end ?? "").slice(0, 10))}. ` : ""}${esc(METHOD[inv.method ?? "moyasar"] ?? "Paid")}${inv.payment_reference ? ` (ref ${esc(inv.payment_reference)})` : ""}.</p>`);
}

/** Opens the credit note in a printable window (with its ZATCA QR code). */
export async function printSubscriptionCreditNote(cn: SubscriptionCreditNoteDoc) {
  const code = await qr(cn.seller.name, cn.seller.vat_number, cn.issued_at, cn.total, cn.vat_amount);
  open(cn.credit_note_number, `<div class="grid"><div><h1>Credit Note · إشعار دائن</h1><p class="muted">${esc(cn.credit_note_number)} · ${esc(when(cn.issued_at))}</p></div>
<img src="${code}" alt="ZATCA QR" width="120" height="120"></div>
${cn.original_invoice_number ? `<p class="ref">Issued against tax invoice <b>${esc(cn.original_invoice_number)}</b>${cn.original_issued_at ? ` of ${esc(format(new Date(cn.original_issued_at), "d MMM yyyy"))}` : ""}. Reason: ${esc(cn.reason)}</p>` : `<p class="ref">Reason: ${esc(cn.reason)}</p>`}
${parties(cn)}
<table><thead><tr><th>Description</th><th>Amount credited (SAR, excl. VAT)</th></tr></thead><tbody>
${cn.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${sar(l.amount)}</td></tr>`).join("")}</tbody></table>
<table class="tot"><tr><td>Subtotal</td><td>${sar(cn.subtotal)}</td></tr><tr><td>VAT ${(cn.vat_rate * 100).toFixed(0)}%</td><td>${sar(cn.vat_amount)}</td></tr>
<tr><td><b>Total credited</b></td><td><b>SAR ${sar(cn.total)}</b></td></tr></table>
<p class="muted">${cn.method === "moyasar" ? "Refunded to the card used for the payment" : "Refunded outside Matbex (e.g. bank transfer)"}${cn.refund_reference ? ` (ref ${esc(cn.refund_reference)})` : ""}.${cn.ended_period ? " The paid period ended with this refund." : ""}</p>`);
}
