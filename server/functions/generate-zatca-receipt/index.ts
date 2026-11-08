// =====================================================================
// generate-zatca-receipt
// ---------------------------------------------------------------------
// Generates a ZATCA Phase-1 compliant simplified-tax-invoice PDF
// receipt for a single sale. The PDF embeds the canonical TLV-encoded
// QR code and uses an invoice snapshot (seller name + VAT number +
// totals) so historical receipts remain reproducible regardless of
// later settings changes.
//
// Input is intentionally self-contained - the caller (browser POS)
// supplies the snapshot. The function never reads zatca_settings on
// its own; that decision lives in the client so the same payload
// drives the printed, digital, and PDF receipts.
// =====================================================================

// @ts-ignore deno remote
import { serve } from "../_runtime/serve.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
// @ts-ignore deno remote
import PDFDocument from "pdfkit";
// @ts-ignore deno remote
import QRCode from "qrcode";

interface ReceiptItem {
  name: string;
  size?: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface ZatcaSnapshot {
  sellerName: string;
  sellerNameAr?: string | null;
  vatNumber: string;
  /** ISO 8601 */
  timestamp: string;
  /** Decimal string with 2 fraction digits, e.g. "115.00" */
  invoiceTotal: string;
  /** Decimal string with 2 fraction digits, e.g. "15.00" */
  vatTotal: string;
}

interface RequestBody {
  receiptNumber: string;
  date: string;
  cashierName?: string | null;
  customerName?: string | null;
  paymentMethod: string;
  header?: string | null;
  footer?: string | null;
  currencySymbol?: string | null;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  total: number;
  zatca: ZatcaSnapshot;
  /** STRICT blocks if QR cannot be generated. SOFT degrades silently. */
  mode?: "STRICT" | "SOFT";
}

// ----- TLV ENCODER (mirrors src/lib/zatca/tlv.ts) ------------------------
const encoder = new TextEncoder();
function encodeTlv(tag: number, value: string): Uint8Array {
  const bytes = encoder.encode(value ?? "");
  if (bytes.length > 255) {
    throw new Error(`TLV value for tag ${tag} exceeds 255 bytes`);
  }
  const out = new Uint8Array(2 + bytes.length);
  out[0] = tag;
  out[1] = bytes.length;
  out.set(bytes, 2);
  return out;
}
function tlvBase64(snap: ZatcaSnapshot): string {
  const parts = [
    encodeTlv(1, snap.sellerName),
    encodeTlv(2, snap.vatNumber),
    encodeTlv(3, snap.timestamp),
    encodeTlv(4, snap.invoiceTotal),
    encodeTlv(5, snap.vatTotal),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function validate(body: RequestBody): string[] {
  const errs: string[] = [];
  if (!body.receiptNumber) errs.push("receiptNumber is required");
  if (!body.zatca) errs.push("zatca snapshot is required");
  if (body.zatca) {
    if (!body.zatca.sellerName?.trim()) errs.push("zatca.sellerName missing");
    if (!/^\d{15}$/.test(body.zatca.vatNumber ?? ""))
      errs.push("zatca.vatNumber must be 15 digits");
    if (!body.zatca.timestamp) errs.push("zatca.timestamp missing");
    if (!body.zatca.invoiceTotal) errs.push("zatca.invoiceTotal missing");
    if (body.zatca.vatTotal === undefined) errs.push("zatca.vatTotal missing");
  }
  if (!Array.isArray(body.items) || body.items.length === 0)
    errs.push("items must be a non-empty array");
  return errs;
}

function fmt(n: number, currency: string): string {
  return `${currency} ${(Math.round(n * 100) / 100).toFixed(2)}`;
}

async function buildPdf(body: RequestBody, qrPngBase64: string | null): Promise<Uint8Array> {
  // 80mm thermal-style page: 226pt wide, dynamic height.
  const doc = new PDFDocument({
    size: [226, 700],
    margin: 16,
    info: {
      Title: `ZATCA Receipt ${body.receiptNumber}`,
      Author: body.zatca.sellerName,
    },
  });

  const chunks: Uint8Array[] = [];
  doc.on("data", (c: Uint8Array) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const currency = body.currencySymbol || "SAR";

  // Header - seller name (English + Arabic if present)
  doc.font("Helvetica-Bold").fontSize(13).text(body.zatca.sellerName, { align: "center" });
  if (body.zatca.sellerNameAr) {
    doc.font("Helvetica").fontSize(11).text(body.zatca.sellerNameAr, { align: "center" });
  }
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(8).text(
    `VAT Reg. No: ${body.zatca.vatNumber}`,
    { align: "center" }
  );
  doc.font("Helvetica-Bold").fontSize(9).text("Simplified Tax Invoice", {
    align: "center",
  });

  doc.moveDown(0.3);
  // Divider
  doc.moveTo(16, doc.y).lineTo(210, doc.y).dash(1, { space: 2 }).stroke().undash();
  doc.moveDown(0.3);

  // Meta
  doc.font("Helvetica").fontSize(8);
  doc.text(`Receipt: ${body.receiptNumber}`);
  doc.text(`Date: ${new Date(body.date).toLocaleString()}`);
  if (body.cashierName) doc.text(`Cashier: ${body.cashierName}`);
  if (body.customerName) doc.text(`Customer: ${body.customerName}`);

  doc.moveDown(0.3);
  doc.moveTo(16, doc.y).lineTo(210, doc.y).dash(1, { space: 2 }).stroke().undash();
  doc.moveDown(0.3);

  // Items
  doc.font("Helvetica").fontSize(8);
  for (const item of body.items) {
    const label = `${item.quantity}x ${item.name}${item.size ? ` (${item.size})` : ""}`;
    const totalStr = fmt(item.total, currency);
    const startY = doc.y;
    doc.text(label, 16, startY, { width: 140 });
    doc.text(totalStr, 156, startY, { width: 54, align: "right" });
    // Move below the taller of the two columns
    doc.y = Math.max(doc.y, startY + 10);
  }

  doc.moveDown(0.3);
  doc.moveTo(16, doc.y).lineTo(210, doc.y).dash(1, { space: 2 }).stroke().undash();
  doc.moveDown(0.3);

  // Totals
  const totalsRow = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 8);
    doc.text(label, 16, y, { width: 140 });
    doc.text(value, 156, y, { width: 54, align: "right" });
    doc.y = y + (bold ? 14 : 11);
  };
  totalsRow("Subtotal", fmt(body.subtotal, currency));
  totalsRow("VAT", fmt(body.tax, currency));
  totalsRow("TOTAL", fmt(body.total, currency), true);

  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(8).text(
    `Paid by: ${body.paymentMethod.toUpperCase()}`,
    { align: "center" }
  );

  // ZATCA QR
  if (qrPngBase64) {
    doc.moveDown(0.5);
    const qrSize = 110;
    const qrX = (226 - qrSize) / 2;
    const qrBytes = Uint8Array.from(atob(qrPngBase64), (c) => c.charCodeAt(0));
    doc.image(qrBytes, qrX, doc.y, { width: qrSize, height: qrSize });
    doc.y += qrSize + 4;
    doc.font("Helvetica").fontSize(7).text("ZATCA Phase 1 - Scan to verify", {
      align: "center",
    });
  }

  if (body.footer) {
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(7).text(body.footer, { align: "center" });
  }

  doc.end();
  await done;

  const totalLen = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;
    const errs = validate(body);
    if (errs.length) {
      return new Response(
        JSON.stringify({ error: "Invalid payload", details: errs }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Encode TLV → QR PNG (base64)
    let qrBase64Tlv: string | null = null;
    let qrPngBase64: string | null = null;
    try {
      qrBase64Tlv = tlvBase64(body.zatca);
      const dataUrl: string = await QRCode.toDataURL(qrBase64Tlv, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320,
      });
      qrPngBase64 = dataUrl.split(",")[1] ?? null;
    } catch (qrErr) {
      console.error("QR generation failed:", qrErr);
      if ((body.mode ?? "STRICT") === "STRICT") {
        return new Response(
          JSON.stringify({
            error: "QR generation failed",
            details: (qrErr as Error).message,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const pdfBytes = await buildPdf(body, qrPngBase64);

    // base64 - chunked to avoid call-stack blowups on large arrays
    let bin = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < pdfBytes.length; i += chunkSize) {
      bin += String.fromCharCode(
        ...pdfBytes.subarray(i, Math.min(i + chunkSize, pdfBytes.length)),
      );
    }
    const pdfBase64 = btoa(bin);

    return new Response(
      JSON.stringify({
        pdf: pdfBase64,
        qrBase64: qrBase64Tlv,
        bytes: pdfBytes.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("generate-zatca-receipt failed:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
};

serve(handler);