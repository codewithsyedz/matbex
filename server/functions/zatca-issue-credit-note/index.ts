import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// =====================================================================
// zatca-issue-credit-note
// ---------------------------------------------------------------------
// Issues a ZATCA-compliant Simplified Credit Note for a previously
// recorded sale. End-to-end pipeline:
//   1. Validate caller + load original sale + device + ZATCA settings
//   2. Build the credit/debit note UBL (<Invoice>, InvoiceTypeCode 381/383)
//   3. Pre-flight schema validation (fail fast - store SCHEMA_INVALID)
//   4. Advance device chain (next ICV / PIH) via next_zatca_chain RPC
//   5. Invoke zatca-sign-invoice to XAdES-sign the UBL
//   6. POST to Fatoora /invoices/reporting/single (or simulate)
//   7. Persist final clearance status + response on zatca_credit_notes
// =====================================================================

import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";

// Request-scoped CORS headers. Assigned at the top of every request so the
// module-level response helpers below can spread them without a ReferenceError.
let corsHeaders: Record<string, string> = buildCorsHeaders(new Request("https://matbex.com"));
interface RefundLine {
  name: string;
  quantity: number;
  unitPrice: number;
  /** Pre-tax extension (qty * unit, after discounts). */
  lineExtension: number;
  /** VAT amount on this line. */
  taxAmount: number;
}

interface Body {
  original_sales_transaction_id: string;
  reason_code: string;
  reason_text?: string | null;
  refund_lines: RefundLine[];
  /** CREDIT (refund, default) or DEBIT (additional charge). */
  document_type?: "CREDIT" | "DEBIT";
}

function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function money(n: number): string { return (Math.round(n * 100) / 100).toFixed(2); }

async function sha256B64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const n = new Date();
    return { date: n.toISOString().slice(0, 10), time: n.toISOString().slice(11, 19) };
  }
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 19) };
}

// ---- Builders (copy of src/lib/zatca/ubl.ts; edge runtime can't import src) ----

function buildAdjustmentUbl(input: {
  documentType: "CREDIT" | "DEBIT";
  uuid: string;
  receiptNumber: string;
  issueDateTime: string;
  icv: number;
  pih: string;
  qrBase64: string | null;
  seller: { nameEn: string; nameAr?: string | null; vatNumber: string; crNumber?: string | null; addressLine?: string | null; city?: string | null; countryCode?: string | null };
  currency: string;
  lines: Array<{ name: string; quantity: number; unitPrice: number; lineExtension: number; taxAmount: number }>;
  taxExclusiveAmount: number;
  taxAmount: number;
  taxInclusiveAmount: number;
  paymentMeansCode?: string;
  originalUuid: string;
  originalReceiptNumber: string;
  reasonCode: string;
  reasonText?: string | null;
}): string {
  const { date, time } = splitDateTime(input.issueDateTime);
  const currency = input.currency || "SAR";
  const country = input.seller.countryCode || "SA";
  const pmc = input.paymentMeansCode || "10";
  const isDebit = input.documentType === "DEBIT";
  // ZATCA (e-invoicing XML implementation standard) issues credit and debit notes as UBL
  // <Invoice> documents: InvoiceTypeCode 381 = credit note, 383 = debit note, with a
  // BillingReference to the original invoice and the reason in PaymentMeans/InstructionNote.
  // The UBL <CreditNote> document is not accepted (and the signer only handles <Invoice>).
  const rootElem = "Invoice";
  const rootNs = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
  const lineElem = "InvoiceLine";
  const qtyElem = "InvoicedQuantity";
  const typeCodeElem = "InvoiceTypeCode";
  const typeCodeValue = isDebit ? "383" : "381";

  const lineXml = input.lines.map((l, idx) => {
    const id = idx + 1;
    const qty = (Math.round(l.quantity * 1000) / 1000).toFixed(3);
    const taxable = money(l.lineExtension);
    const tax = money(l.taxAmount);
    const inclusive = money(l.lineExtension + l.taxAmount);
    const unit = money(l.unitPrice);
    return `  <cac:${lineElem}>
    <cbc:ID>${id}</cbc:ID>
    <cbc:${qtyElem} unitCode="PCE">${qty}</cbc:${qtyElem}>
    <cbc:LineExtensionAmount currencyID="${currency}">${taxable}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${currency}">${tax}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="${currency}">${inclusive}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${esc(l.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>15.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${unit}</cbc:PriceAmount>
    </cac:Price>
  </cac:${lineElem}>`;
  }).join("\n");

  const qrRef = input.qrBase64
    ? `  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(input.qrBase64)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>`
    : "";

  const sellerNameAr = input.seller.nameAr
    ? `\n      <cbc:RegistrationName>${esc(input.seller.nameAr)}</cbc:RegistrationName>`
    : "";

  const reason = esc(input.reasonText || input.reasonCode);

  return `<?xml version="1.0" encoding="UTF-8"?>
<${rootElem} xmlns="${rootNs}"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(input.receiptNumber)}</cbc:ID>
  <cbc:UUID>${esc(input.uuid)}</cbc:UUID>
  <cbc:IssueDate>${date}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>
  <cbc:${typeCodeElem} name="0200000">${typeCodeValue}</cbc:${typeCodeElem}>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${currency}</cbc:TaxCurrencyCode>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${esc(input.originalReceiptNumber)}</cbc:ID>
      <cbc:UUID>${esc(input.originalUuid)}</cbc:UUID>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${input.icv}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(input.pih)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
${qrRef}
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${esc(input.seller.crNumber || "0000000000")}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(input.seller.addressLine || "N/A")}</cbc:StreetName>
        <cbc:CityName>${esc(input.seller.city || "N/A")}</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>${esc(country)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(input.seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(input.seller.nameEn)}</cbc:RegistrationName>${sellerNameAr}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Walk-in Customer</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(pmc)}</cbc:PaymentMeansCode>
    <cbc:InstructionNote>${reason}</cbc:InstructionNote>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${money(input.taxAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${money(input.taxExclusiveAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${money(input.taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>15.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(input.taxExclusiveAmount)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${money(input.taxExclusiveAmount)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${money(input.taxInclusiveAmount)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${money(input.taxInclusiveAmount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lineXml}
</${rootElem}>`;
}

// ---- Pre-flight schema validation ----
function validateUbl(xml: string): { valid: boolean; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = [];
  if (!xml || xml.length < 200) errors.push({ field: "xml", message: "XML body is empty or too short." });
  if (!/<(Invoice|CreditNote)\b/.test(xml)) errors.push({ field: "root", message: "Root must be Invoice or CreditNote." });
  for (const t of [
    ["cbc:ID", "Document number"], ["cbc:UUID", "UUID"], ["cbc:IssueDate", "Issue date"],
    ["cbc:IssueTime", "Issue time"], ["cac:AccountingSupplierParty", "Supplier party"],
    ["cac:LegalMonetaryTotal", "Monetary totals"], ["cac:TaxTotal", "Tax total"],
  ] as const) {
    if (!new RegExp(`<${t[0].replace(":", "\\:")}\\b`).test(xml)) {
      errors.push({ field: t[0], message: `Missing required element: ${t[1]}` });
    }
  }
  const vat = xml.match(/<cbc:CompanyID\b[^>]*>(.*?)<\/cbc:CompanyID>/);
  if (!vat) errors.push({ field: "cbc:CompanyID", message: "Seller VAT number is missing." });
  else if (!/^\d{15}$/.test(vat[1].trim())) errors.push({ field: "cbc:CompanyID", message: `Seller VAT must be 15 digits (got "${vat[1]}").` });
  if (!/<cac:TaxCategory>[\s\S]*?<cbc:ID>([SZEO])<\/cbc:ID>/m.test(xml)) errors.push({ field: "cac:TaxCategory", message: "VAT category code (S/Z/E/O) is required." });
  if (!/<cbc:ID>ICV<\/cbc:ID>/.test(xml)) errors.push({ field: "ICV", message: "ICV reference missing." });
  if (!/<cbc:ID>PIH<\/cbc:ID>/.test(xml)) errors.push({ field: "PIH", message: "PIH reference missing." });
  if (/<cbc:InvoiceTypeCode\b[^>]*>(381|383)</.test(xml) && !/<cac:BillingReference>/.test(xml)) errors.push({ field: "cac:BillingReference", message: "Credit and debit notes must reference the original invoice." });
  return { valid: errors.length === 0, errors };
}

serve(async (req) => {
  corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const db = createClient(
    env("API_URL") ?? "",
    env("ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: claims } = await db.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (!claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.original_sales_transaction_id || !Array.isArray(body.refund_lines) || body.refund_lines.length === 0) {
    return json({ error: "original_sales_transaction_id and refund_lines required" }, 400);
  }
  const documentType: "CREDIT" | "DEBIT" =
    body.document_type === "DEBIT" ? "DEBIT" : "CREDIT";

  // 1. Load original sale
  const { data: sale, error: saleErr } = await db
    .from("sales_transactions")
    .select("id, restaurant_id, receipt_number, total_amount:total, zatca_device_id, zatca_uuid, zatca_pih, zatca_icv, zatca_clearance_status")
    .eq("id", body.original_sales_transaction_id)
    .single();
  if (saleErr || !sale) return json({ error: saleErr?.message ?? "Original sale not found" }, 404);
  const { data: saleRestaurant } = await db
    .from("restaurants")
    .select("tenant_id")
    .eq("id", sale.restaurant_id)
    .maybeSingle();
  const saleTenantId = saleRestaurant?.tenant_id as string | undefined;
  if (!saleTenantId) return json({ error: "Tenant not found for sale" }, 404);
  if (!sale.zatca_uuid || !sale.zatca_device_id) {
    return json({ error: "Original sale was not stamped with ZATCA - cannot issue credit note" }, 409);
  }

  // 2. Load device + ZATCA settings
  const { data: device } = await db
    .from("zatca_devices")
    .select("id, restaurant_id")
    .eq("id", sale.zatca_device_id)
    .single();
  const { data: settings } = await db
    .from("zatca_settings")
    // zatca_settings has seller_name_en / vat_registration_number / branch_address_en (no city,
    // country or currency columns); the old column list made this query fail every time.
    .select("seller_name:seller_name_en, seller_name_ar, vat_number:vat_registration_number, cr_number, address_line:branch_address_en")
    .eq("tenant_id", saleTenantId)
    .maybeSingle();
  if (!device || !settings) return json({ error: "Device or ZATCA settings missing" }, 404);

  // 3. Compute refund totals
  const taxExclusive = body.refund_lines.reduce((s, l) => s + Number(l.lineExtension || 0), 0);
  const taxAmount = body.refund_lines.reduce((s, l) => s + Number(l.taxAmount || 0), 0);
  const taxInclusive = taxExclusive + taxAmount;

  if (taxInclusive <= 0) {
    return json({
      error: documentType === "DEBIT"
        ? "Charge amount must be greater than zero"
        : "Refund amount must be greater than zero",
    }, 400);
  }

  // 4. Insert PENDING note row first to reserve number
  const cnUuid = crypto.randomUUID();
  const numberPrefix = documentType === "DEBIT" ? "DN" : "CN";
  const cnNumber = `${numberPrefix}-${(sale.receipt_number || sale.id.slice(0, 8))}-${Date.now().toString().slice(-6)}`;

  const { data: cnRow, error: cnInsErr } = await db
    .from("zatca_credit_notes")
    .insert({
      tenant_id: saleTenantId,
      restaurant_id: sale.restaurant_id,
      device_id: sale.zatca_device_id,
      original_sales_transaction_id: sale.id,
      original_uuid: sale.zatca_uuid,
      original_pih: sale.zatca_pih,
      original_icv: sale.zatca_icv,
      credit_note_number: cnNumber,
      uuid: cnUuid,
      reason_code: body.reason_code,
      reason_text: body.reason_text ?? null,
      total_refunded: taxInclusive,
      vat_refunded: taxAmount,
      refund_lines: body.refund_lines,
      document_type: documentType,
      created_by: userId,
    })
    .select("id")
    .single();
  if (cnInsErr || !cnRow) return json({ error: cnInsErr?.message ?? "Failed to create credit note row" }, 500);

  try {
    // 5. Advance device chain
    const issueDateTime = new Date().toISOString();
    // Compute hash placeholder of canonical body (will be replaced post-build)
    const seedHash = await sha256B64(`${cnUuid}|${cnNumber}|${taxInclusive}`);
    // The caller's access to the sale and device was checked above (RLS); the chain itself is
    // allocated with the service client because browsers may no longer call next_zatca_chain
    // (migration 20261110180818).
    const admin = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "");
    const { data: chain, error: chainErr } = await admin.rpc("next_zatca_chain", {
      _device_id: sale.zatca_device_id,
      _invoice_hash: seedHash,
    });
    if (chainErr || !chain) throw new Error(chainErr?.message ?? "next_zatca_chain failed");
    const chainRow = (Array.isArray(chain) ? chain[0] : chain) as { icv: number; pih: string };

    // 6. Build UBL
    const xml = buildAdjustmentUbl({
      documentType,
      uuid: cnUuid,
      receiptNumber: cnNumber,
      issueDateTime,
      icv: Number(chainRow.icv),
      pih: chainRow.pih,
      qrBase64: null,
      seller: {
        nameEn: settings.seller_name ?? "Seller",
        nameAr: settings.seller_name_ar,
        vatNumber: settings.vat_number ?? "",
        crNumber: settings.cr_number,
        addressLine: settings.address_line,
        city: (settings as { city?: string | null }).city ?? null,
        countryCode: (settings as { country_code?: string | null }).country_code ?? "SA",
      },
      currency: (settings as { currency?: string | null }).currency || "SAR",
      lines: body.refund_lines,
      taxExclusiveAmount: taxExclusive,
      taxAmount,
      taxInclusiveAmount: taxInclusive,
      originalUuid: sale.zatca_uuid,
      originalReceiptNumber: sale.receipt_number ?? sale.id.slice(0, 8),
      reasonCode: body.reason_code,
      reasonText: body.reason_text,
    });

    // 7. Schema pre-flight
    const v = validateUbl(xml);
    if (!v.valid) {
      await db.from("zatca_credit_notes").update({
        clearance_status: "SCHEMA_INVALID",
        schema_validation_errors: v.errors,
        icv: Number(chainRow.icv),
        pih: chainRow.pih,
      }).eq("id", cnRow.id);
      return json({ ok: false, status: "SCHEMA_INVALID", errors: v.errors, credit_note_id: cnRow.id }, 422);
    }

    // 8. Real invoice hash (canonical XML SHA-256)
    const invoiceHash = await sha256B64(xml);

    // 9. Sign via zatca-sign-invoice
    const signRes = await db.functions.invoke("zatca-sign-invoice", {
      body: {
        device_id: sale.zatca_device_id,
        receipt_number: cnNumber,
        xml,
        invoice_hash: invoiceHash,
      },
    });
    if (signRes.error) throw new Error(`Signing failed: ${signRes.error.message}`);
    const signed = signRes.data as { signed_xml_url: string | null; signature: string };

    // 10. Mark as PENDING with hash + signed url; submit to Fatoora (or simulate)
    const baseUrl = env("ZATCA_BASE_URL");
    let clearanceStatus = "CLEARED_SIM";
    let clearanceResponse: unknown = { simulated: true, note: "ZATCA_BASE_URL not configured" };

    if (baseUrl && signed.signed_xml_url) {
      try {
        const xmlText = await (await fetch(signed.signed_xml_url)).text();
        const r = await fetch(`${baseUrl}/invoices/reporting/single`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept-Language": "en",
            "Accept-Version": "V2",
          },
          body: JSON.stringify({
            invoiceHash,
            uuid: cnUuid,
            invoice: btoa(xmlText),
          }),
        });
        clearanceResponse = await r.json().catch(() => ({ status: r.status }));
        clearanceStatus = r.ok ? "REPORTED" : "REJECTED";
      } catch (e) {
        clearanceStatus = "REJECTED";
        clearanceResponse = { error: (e as Error).message };
      }
    }

    await db.from("zatca_credit_notes").update({
      icv: Number(chainRow.icv),
      pih: chainRow.pih,
      invoice_hash: invoiceHash,
      signed_xml_url: signed.signed_xml_url,
      clearance_status: clearanceStatus,
      clearance_response: clearanceResponse,
      cleared_at: clearanceStatus !== "REJECTED" ? new Date().toISOString() : null,
    }).eq("id", cnRow.id);

    return json({
      ok: true,
      credit_note_id: cnRow.id,
      uuid: cnUuid,
      number: cnNumber,
      status: clearanceStatus,
    });
  } catch (e) {
    const msg = (e as Error).message;
    await db.from("zatca_credit_notes").update({
      clearance_status: "REJECTED",
      clearance_response: { error: msg },
    }).eq("id", cnRow.id);
    return json({ error: msg, credit_note_id: cnRow.id }, 500);
  }
});