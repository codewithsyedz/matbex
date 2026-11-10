// =====================================================================
// ZATCA UBL 2.1 - Simplified Tax Invoice XML generator
// ---------------------------------------------------------------------
// Produces a UBL 2.1 invoice document compatible with ZATCA Phase 2
// (E-invoicing - Simplified Tax Invoice, B2C). The XML embeds:
//   - Invoice UUID, ICV (cbc:ID stamp), PIH (Previous Invoice Hash)
//   - Seller (sufficient for Simplified) + 15-digit VAT number
//   - Line items, monetary totals and a single 15% VAT category
//   - The TLV-encoded QR (base64) as the AdditionalDocumentReference
//
// This is a deterministic builder - no XML library, plain strings -
// because UBL is just escaped text and we control every field.
// Once the signing pipeline is wired in (CSID + cryptographic stamp),
// the same builder will be the input to the canonicalizer/signer.
// =====================================================================

export interface UblLine {
  name: string;
  quantity: number;
  unitPrice: number;
  /** Pre-tax line extension (qty * unit price, after discounts). */
  lineExtension: number;
  /** Tax amount for this line (15% of lineExtension by default). */
  taxAmount: number;
  /** ZATCA VAT category: S=standard, Z=zero, E=exempt, O=out-of-scope. Defaults to S. */
  vatCategory?: "S" | "Z" | "E" | "O";
  /** Required for E and O categories. e.g. VATEX-SA-29 */
  vatExemptionReasonCode?: string | null;
}

/**
 * ZATCA buyer identification scheme codes (from `IdentificationScheme`
 * code list). Use one when the buyer has no VAT number - e.g. an
 * individual, a foreign entity, or a domestic non-registered business.
 */
export type BuyerIdScheme =
  | "TIN"  // Tax Identification Number (15-digit VAT)
  | "CRN"  // Commercial Registration Number
  | "MOM"  // Momra (municipality) license
  | "MLS"  // MLSD license
  | "SAG"  // Sagia license
  | "NAT"  // National ID
  | "GCC"  // GCC ID
  | "IQA"  // Iqama
  | "PAS"  // Passport
  | "OTH"; // Other

/**
 * Document-level allowance or charge. Negative `chargeIndicator`=false
 * means an allowance (discount); true means a surcharge.
 */
export interface DocumentAllowanceCharge {
  isCharge: boolean;
  amount: number;
  reason?: string;
  reasonCode?: string;
  /** VAT category that this allowance/charge attaches to. */
  vatCategory?: "S" | "Z" | "E" | "O";
  vatExemptionReasonCode?: string | null;
}

export interface BuildUblInput {
  uuid: string;
  receiptNumber: string;
  /** ISO 8601 timestamp of the sale. */
  issueDateTime: string;
  icv: number;
  pih: string;
  /** Base64 TLV QR payload - embedded as AdditionalDocumentReference. */
  qrBase64: string | null;
  seller: {
    nameEn: string;
    nameAr?: string | null;
    vatNumber: string;
    crNumber?: string | null;
    addressLine?: string | null;
    city?: string | null;
    countryCode?: string | null;
  };
  /** When provided, emits Standard Tax Invoice (B2B). */
  buyer?: {
    name: string;
    /** 15-digit VAT - required only for VAT-registered B2B buyers. */
    vatNumber?: string | null;
    address?: string | null;
    countryCode?: string | null;
    /**
     * Non-VAT identification (CRN/NAT/PAS…) - used when the buyer is
     * not VAT-registered. Either `vatNumber` OR `identification` should
     * be present for STANDARD invoices.
     */
    identification?: { scheme: BuyerIdScheme; value: string } | null;
  } | null;
  /** SIMPLIFIED (B2C, code 0200000/388) or STANDARD (B2B, code 0100000/388). */
  invoiceSubtype?: "SIMPLIFIED" | "STANDARD";
  /** Document currency (cbc:DocumentCurrencyCode). */
  currency: string;
  /**
   * Tax currency (cbc:TaxCurrencyCode). Defaults to `currency`. ZATCA
   * requires SAR; when `currency` is non-SAR you MUST also supply
   * `taxExchangeRate` so Fatoora can convert tax amounts.
   */
  taxCurrency?: string;
  /** SAR-per-DocumentCurrency rate. e.g. USD invoice → 3.75. */
  taxExchangeRate?: number;
  lines: UblLine[];
  /** Pre-tax total. */
  taxExclusiveAmount: number;
  /** Total VAT. */
  taxAmount: number;
  /** Grand total (incl. VAT). */
  taxInclusiveAmount: number;
  paymentMeansCode?: string;
  /** Document-level allowances (discounts) and charges (surcharges). */
  allowanceCharges?: DocumentAllowanceCharge[];
  /**
   * Optional PayableRoundingAmount - emitted as
   * `cbc:PayableRoundingAmount` and folded into `PayableAmount`.
   * Positive = round up, negative = round down.
   */
  payableRoundingAmount?: number;
  /**
   * Standard-rate VAT percentage for this invoice (e.g. 15 for 15%).
   * Configurable per branch; defaults to 15.
   */
  vatRatePercent?: number;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return { date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 19) };
  }
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 19) };
}

function vatPercentFor(cat: "S" | "Z" | "E" | "O", ratePercent = 15): string {
  return cat === "S" ? ratePercent.toFixed(2) : "0.00";
}

function classifiedTaxCategoryXml(cat: "S" | "Z" | "E" | "O", reason?: string | null, ratePercent = 15): string {
  const reasonXml =
    (cat === "E" || cat === "O") && reason
      ? `\n        <cbc:TaxExemptionReasonCode>${esc(reason)}</cbc:TaxExemptionReasonCode>`
      : "";
  return `<cac:ClassifiedTaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${vatPercentFor(cat, ratePercent)}</cbc:Percent>${reasonXml}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>`;
}

/**
 * Build a UBL 2.1 Simplified Tax Invoice document.
 * InvoiceTypeCode 388 + name "0200000" (Simplified/B2C) or
 * "0100000" (Standard/B2B) per ZATCA.
 */
export function buildSimplifiedTaxInvoiceUbl(input: BuildUblInput): string {
  const { date, time } = splitDateTime(input.issueDateTime);
  const currency = input.currency || "SAR";
  const taxCurrency = input.taxCurrency || currency;
  const country = input.seller.countryCode || "SA";
  const pmc = input.paymentMeansCode || "10"; // 10 = cash
  const isStandard = input.invoiceSubtype === "STANDARD";
  const typeCodeName = isStandard ? "0100000" : "0200000";
  const vatRatePercent =
    typeof input.vatRatePercent === "number" && isFinite(input.vatRatePercent)
      ? input.vatRatePercent
      : 15;

  const lineXml = input.lines
    .map((l, idx) => {
      const id = idx + 1;
      const qty = (Math.round(l.quantity * 1000) / 1000).toFixed(3);
      const taxable = money(l.lineExtension);
      const tax = money(l.taxAmount);
      const inclusive = money(l.lineExtension + l.taxAmount);
      const unit = money(l.unitPrice);
      const cat = l.vatCategory ?? "S";
      return `  <cac:InvoiceLine>
    <cbc:ID>${id}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${taxable}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${currency}">${tax}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="${currency}">${inclusive}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${esc(l.name)}</cbc:Name>
      ${classifiedTaxCategoryXml(cat, l.vatExemptionReasonCode, vatRatePercent)}
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${unit}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join("\n");

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

  // ----- Document-level AllowanceCharge -----
  const allowanceCharges = input.allowanceCharges ?? [];
  const allowanceChargeXml = allowanceCharges
    .map((ac) => {
      const cat = ac.vatCategory ?? "S";
      const reasonCodeXml = ac.reasonCode
        ? `\n    <cbc:AllowanceChargeReasonCode>${esc(ac.reasonCode)}</cbc:AllowanceChargeReasonCode>`
        : "";
      const reasonXml = ac.reason
        ? `\n    <cbc:AllowanceChargeReason>${esc(ac.reason)}</cbc:AllowanceChargeReason>`
        : "";
      const vatExemptionXml =
        (cat === "E" || cat === "O") && ac.vatExemptionReasonCode
          ? `\n      <cbc:TaxExemptionReasonCode>${esc(ac.vatExemptionReasonCode)}</cbc:TaxExemptionReasonCode>`
          : "";
      return `  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>${ac.isCharge ? "true" : "false"}</cbc:ChargeIndicator>${reasonCodeXml}${reasonXml}
    <cbc:Amount currencyID="${currency}">${money(ac.amount)}</cbc:Amount>
    <cac:TaxCategory>
      <cbc:ID>${cat}</cbc:ID>
      <cbc:Percent>${vatPercentFor(cat, vatRatePercent)}</cbc:Percent>${vatExemptionXml}
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>`;
    })
    .join("\n");

  const allowanceTotal = allowanceCharges
    .filter((a) => !a.isCharge)
    .reduce((s, a) => s + Number(a.amount || 0), 0);
  const chargeTotal = allowanceCharges
    .filter((a) => a.isCharge)
    .reduce((s, a) => s + Number(a.amount || 0), 0);

  // Aggregate per-VAT-category subtotals
  const buckets: Record<string, { taxable: number; tax: number; reason?: string | null }> = {};
  for (const l of input.lines) {
    const cat = l.vatCategory ?? "S";
    const b = buckets[cat] ?? { taxable: 0, tax: 0, reason: l.vatExemptionReasonCode };
    b.taxable += l.lineExtension;
    b.tax += l.taxAmount;
    if (!b.reason && l.vatExemptionReasonCode) b.reason = l.vatExemptionReasonCode;
    buckets[cat] = b;
  }
  // Fold document-level allowance/charge amounts into their VAT bucket
  for (const ac of allowanceCharges) {
    const cat = ac.vatCategory ?? "S";
    const b = buckets[cat] ?? { taxable: 0, tax: 0, reason: ac.vatExemptionReasonCode };
    const sign = ac.isCharge ? 1 : -1;
    b.taxable += sign * Number(ac.amount || 0);
    if (cat === "S") b.tax += sign * Number(ac.amount || 0) * (vatRatePercent / 100);
    if (!b.reason && ac.vatExemptionReasonCode) b.reason = ac.vatExemptionReasonCode;
    buckets[cat] = b;
  }
  const taxSubtotalsXml = Object.entries(buckets)
    .map(([cat, b]) => {
      const reasonXml =
        (cat === "E" || cat === "O") && b.reason
          ? `\n        <cbc:TaxExemptionReasonCode>${esc(b.reason)}</cbc:TaxExemptionReasonCode>`
          : "";
      return `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${money(b.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${money(b.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${vatPercentFor(cat as "S"|"Z"|"E"|"O", vatRatePercent)}</cbc:Percent>${reasonXml}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
    })
    .join("\n");

  // Buyer identification: prefer non-VAT scheme when supplied, else
  // fall back to PartyTaxScheme/CompanyID (15-digit VAT).
  const buyerIdXml = isStandard && input.buyer?.identification
    ? `      <cac:PartyIdentification>
        <cbc:ID schemeID="${esc(input.buyer.identification.scheme)}">${esc(input.buyer.identification.value)}</cbc:ID>
      </cac:PartyIdentification>\n`
    : "";
  const buyerVatXml = isStandard && input.buyer?.vatNumber
    ? `      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(input.buyer.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>\n`
    : "";
  const customerXml = isStandard && input.buyer
    ? `  <cac:AccountingCustomerParty>
    <cac:Party>
${buyerIdXml}      <cac:PostalAddress>
        <cbc:StreetName>${esc(input.buyer.address || "N/A")}</cbc:StreetName>
        <cac:Country><cbc:IdentificationCode>${esc(input.buyer.countryCode || "SA")}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
${buyerVatXml}      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(input.buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`
    : `  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Walk-in Customer</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;

  // Tax exchange rate (only meaningful when DocumentCurrency != TaxCurrency).
  const taxExchangeRateXml =
    currency !== taxCurrency && input.taxExchangeRate
      ? `\n  <cac:TaxExchangeRate>
    <cbc:SourceCurrencyCode>${currency}</cbc:SourceCurrencyCode>
    <cbc:TargetCurrencyCode>${taxCurrency}</cbc:TargetCurrencyCode>
    <cbc:CalculationRate>${input.taxExchangeRate.toFixed(5)}</cbc:CalculationRate>
  </cac:TaxExchangeRate>`
      : "";

  const allowanceTotalXml = allowanceTotal > 0
    ? `\n    <cbc:AllowanceTotalAmount currencyID="${currency}">${money(allowanceTotal)}</cbc:AllowanceTotalAmount>`
    : "";
  const chargeTotalXml = chargeTotal > 0
    ? `\n    <cbc:ChargeTotalAmount currencyID="${currency}">${money(chargeTotal)}</cbc:ChargeTotalAmount>`
    : "";
  const rounding = Number(input.payableRoundingAmount || 0);
  const roundingXml = rounding !== 0
    ? `\n    <cbc:PayableRoundingAmount currencyID="${currency}">${money(rounding)}</cbc:PayableRoundingAmount>`
    : "";
  const payableAmount = input.taxInclusiveAmount + rounding;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(input.receiptNumber)}</cbc:ID>
  <cbc:UUID>${esc(input.uuid)}</cbc:UUID>
  <cbc:IssueDate>${date}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${typeCodeName}">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${taxCurrency}</cbc:TaxCurrencyCode>${taxExchangeRateXml}
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
${customerXml}
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(pmc)}</cbc:PaymentMeansCode>
  </cac:PaymentMeans>
${allowanceChargeXml ? allowanceChargeXml + "\n" : ""}  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${money(input.taxAmount)}</cbc:TaxAmount>
${taxSubtotalsXml}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${money(input.taxExclusiveAmount)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${money(input.taxExclusiveAmount + chargeTotal - allowanceTotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${money(input.taxInclusiveAmount)}</cbc:TaxInclusiveAmount>${allowanceTotalXml}${chargeTotalXml}${roundingXml}
    <cbc:PayableAmount currencyID="${currency}">${money(payableAmount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lineXml}
</Invoice>`;
}

export interface UploadUblArgs {
  restaurantId: string;
  receiptNumber: string;
  xml: string;
}

// =====================================================================
// CREDIT NOTE (UBL 2.1) - for refunds, returns, corrections
// ---------------------------------------------------------------------
// Mirrors buildSimplifiedTaxInvoiceUbl but emits a <CreditNote> root
// with cac:BillingReference linking back to the original invoice UUID.
// Per ZATCA UBL 2.1 spec, simplified credit notes use:
//   InvoiceTypeCode 381 + name "0200000"
//   ProfileID reporting:1.0
//   PaymentMeans/InstructionNote = reason text
// =====================================================================

export type CreditNoteReasonCode =
  | "RETURN_OF_GOODS"
  | "CORRECTION_OF_AMOUNTS"
  | "CHANGE_OF_BUYER"
  | "CANCELLATION"
  | "OTHER";

export interface BuildCreditNoteInput extends BuildUblInput {
  /** UUID of the invoice being credited. */
  originalUuid: string;
  /** Original invoice number (cbc:ID of source). */
  originalReceiptNumber: string;
  reasonCode: CreditNoteReasonCode;
  reasonText?: string | null;
}

export function buildSimplifiedCreditNoteUbl(input: BuildCreditNoteInput): string {
  // Reuse the invoice builder then substitute root + add BillingReference.
  // We do a deterministic, surgical rewrite rather than a second builder.
  const baseInvoiceXml = buildSimplifiedTaxInvoiceUbl(input);

  // 1. Swap root element <Invoice> → <CreditNote>
  let xml = baseInvoiceXml
    .replace(/<Invoice\b/, "<CreditNote")
    .replace("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
             "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2")
    .replace(/<\/Invoice>\s*$/, "</CreditNote>")
    .replace(/<cbc:InvoiceTypeCode\b[^>]*>388<\/cbc:InvoiceTypeCode>/,
             '<cbc:CreditNoteTypeCode name="0200000">381</cbc:CreditNoteTypeCode>')
    .replace(/<cac:InvoiceLine>/g, "<cac:CreditNoteLine>")
    .replace(/<\/cac:InvoiceLine>/g, "</cac:CreditNoteLine>")
    .replace(/<cbc:InvoicedQuantity\b/g, "<cbc:CreditedQuantity")
    .replace(/<\/cbc:InvoicedQuantity>/g, "</cbc:CreditedQuantity>");

  // 2. Inject <cac:BillingReference> right after </cac:AdditionalDocumentReference>
  // for QR (last AdditionalDocumentReference). We anchor on the closing tag of
  // the QR block; if QR missing, anchor on the closing of the PIH block.
  const billingRef = `  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${esc(input.originalReceiptNumber)}</cbc:ID>
      <cbc:UUID>${esc(input.originalUuid)}</cbc:UUID>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`;

  // Insert before <cac:AccountingSupplierParty> - guaranteed anchor.
  xml = xml.replace(
    /<cac:AccountingSupplierParty>/,
    `${billingRef}\n  <cac:AccountingSupplierParty>`,
  );

  // 3. Inject reason text into PaymentMeans as InstructionNote
  if (input.reasonText || input.reasonCode) {
    const note = esc(input.reasonText || input.reasonCode);
    xml = xml.replace(
      /<\/cac:PaymentMeans>/,
      `  <cbc:InstructionNote>${note}</cbc:InstructionNote>\n  </cac:PaymentMeans>`,
    );
  }

  return xml;
}

// =====================================================================
// PRE-FLIGHT SCHEMA VALIDATION
// ---------------------------------------------------------------------
// Lightweight structural checks that catch the ~80% of mistakes that
// would make ZATCA reject the submission. Not a full XSD validation.
// =====================================================================

export interface UblValidationError {
  field: string;
  message: string;
}

export interface UblValidationResult {
  valid: boolean;
  errors: UblValidationError[];
}

const REQUIRED_PATHS: Array<{ tag: string; field: string }> = [
  { tag: "cbc:ID", field: "Document number" },
  { tag: "cbc:UUID", field: "UUID" },
  { tag: "cbc:IssueDate", field: "Issue date" },
  { tag: "cbc:IssueTime", field: "Issue time" },
  { tag: "cbc:DocumentCurrencyCode", field: "Currency" },
  { tag: "cac:AccountingSupplierParty", field: "Supplier party block" },
  { tag: "cac:LegalMonetaryTotal", field: "Monetary totals block" },
  { tag: "cac:TaxTotal", field: "Tax total block" },
];

export function validateUblXml(xml: string): UblValidationResult {
  const errors: UblValidationError[] = [];

  if (!xml || xml.length < 200) {
    errors.push({ field: "xml", message: "XML body is empty or too short." });
    return { valid: false, errors };
  }

  // Root element must be Invoice or CreditNote
  const rootMatch = xml.match(/<(Invoice|CreditNote)\b/);
  if (!rootMatch) {
    errors.push({ field: "root", message: "Root element must be <Invoice> or <CreditNote>." });
  }

  // Required tags
  for (const r of REQUIRED_PATHS) {
    if (!new RegExp(`<${r.tag.replace(":", "\\:")}\\b`).test(xml)) {
      errors.push({ field: r.tag, message: `Missing required element: ${r.field}` });
    }
  }

  // VAT number - 15 digits inside CompanyID
  const vatMatch = xml.match(/<cbc:CompanyID\b[^>]*>(.*?)<\/cbc:CompanyID>/);
  if (!vatMatch) {
    errors.push({ field: "cbc:CompanyID", message: "Seller VAT number is missing." });
  } else if (!/^\d{15}$/.test(vatMatch[1].trim())) {
    errors.push({ field: "cbc:CompanyID", message: `Seller VAT must be 15 digits (got "${vatMatch[1]}").` });
  }

  // VAT category code present
  if (!/<cac:TaxCategory>[\s\S]*?<cbc:ID>([SZEO])<\/cbc:ID>/m.test(xml)) {
    errors.push({ field: "cac:TaxCategory", message: "VAT category code (S/Z/E/O) is required." });
  }

  // ICV present
  if (!/<cbc:ID>ICV<\/cbc:ID>/.test(xml)) {
    errors.push({ field: "ICV", message: "Invoice Counter Value (ICV) reference is missing." });
  }

  // PIH present
  if (!/<cbc:ID>PIH<\/cbc:ID>/.test(xml)) {
    errors.push({ field: "PIH", message: "Previous Invoice Hash (PIH) reference is missing." });
  }

  // Monetary totals positive
  const total = xml.match(/<cbc:TaxInclusiveAmount[^>]*>([\d.]+)<\/cbc:TaxInclusiveAmount>/);
  if (total && Number(total[1]) <= 0) {
    errors.push({ field: "TaxInclusiveAmount", message: "Tax-inclusive total must be greater than zero." });
  }

  // Credit notes must reference an original invoice
  if (xml.includes("<CreditNote") && !/<cac:BillingReference>/.test(xml)) {
    errors.push({ field: "cac:BillingReference", message: "Credit notes must reference the original invoice." });
  }

  // Standard tax invoices (B2B) must include a buyer VAT block
  if (/InvoiceTypeCode\s+name="0100000"/.test(xml)) {
    const buyerBlock = xml.match(/<cac:AccountingCustomerParty>[\s\S]*?<\/cac:AccountingCustomerParty>/);
    const hasBuyerVat = buyerBlock
      && /<cac:PartyTaxScheme>[\s\S]*?<cbc:CompanyID\b[^>]*>\d{15}<\/cbc:CompanyID>/.test(buyerBlock[0]);
    const hasBuyerOtherId = buyerBlock
      && /<cac:PartyIdentification>[\s\S]*?<cbc:ID\s+schemeID="(CRN|MOM|MLS|SAG|NAT|GCC|IQA|PAS|OTH)"/.test(buyerBlock[0]);
    if (!hasBuyerVat && !hasBuyerOtherId) {
      errors.push({
        field: "cac:AccountingCustomerParty",
        message: "Standard (B2B) invoices must include either a 15-digit buyer VAT number or a non-VAT identifier (CRN/NAT/PAS/IQA/MOM/MLS/SAG/GCC/OTH).",
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Upload XML to the private `zatca-xml` bucket and return a long-lived
 * signed URL (1 year). Returns null on failure - caller logs and moves on.
 */
export async function uploadZatcaXml(
  args: UploadUblArgs,
): Promise<string | null> {
  const { db } = await import("@/integrations/db/client");
  try {
    const safe = args.receiptNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${args.restaurantId}/${new Date().getFullYear()}/${safe}.xml`;
    const blob = new Blob([args.xml], { type: "application/xml" });
    const { error } = await db.storage
      .from("zatca-xml")
      .upload(path, blob, { contentType: "application/xml", upsert: true });
    if (error) {
      console.warn("[zatca] XML upload failed:", error.message);
      return null;
    }
    const { data: signed } = await db.storage
      .from("zatca-xml")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    return signed?.signedUrl ?? null;
  } catch (e) {
    console.warn("[zatca] XML upload threw:", e);
    return null;
  }
}

/** Stamp the uploaded XML link on the sale: POST /api/v1/zatca/sales/:id/documents. */
export async function writeXmlUrlToSale(args: {
  restaurantId: string;
  salesTransactionId: string;
  xmlUrl: string;
}): Promise<void> {
  const { recordZatcaDocuments } = await import("@/lib/api/zatca");
  try {
    await recordZatcaDocuments(args.salesTransactionId, { restaurantId: args.restaurantId, xmlUrl: args.xmlUrl });
  } catch (e) {
    console.warn("[zatca] xml url write failed:", e);
  }
}