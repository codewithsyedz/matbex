/**
 * ZATCA Phase 1 - Simplified Tax Invoice QR encoder.
 *
 * Spec: https://zatca.gov.sa/  (E-Invoicing Phase 1)
 * Output is a Base64-encoded TLV (Tag-Length-Value) byte string. Each field is:
 *   - 1 byte tag
 *   - 1 byte length (UTF-8 byte length of value, NOT JS string length)
 *   - N bytes UTF-8 value
 *
 * The five required Phase 1 tags are:
 *   1: Seller name
 *   2: VAT registration number
 *   3: Invoice timestamp (ISO 8601)
 *   4: Invoice total (incl. VAT)
 *   5: VAT total
 */

export interface ZatcaQrInput {
  sellerName: string;
  vatNumber: string;
  /** ISO 8601 string, e.g. 2026-05-08T10:30:00Z */
  timestamp: string;
  /** Decimal string, e.g. "115.00" */
  invoiceTotal: string;
  /** Decimal string, e.g. "15.00" */
  vatTotal: string;
}

export interface TlvTag {
  tag: number;
  name: string;
  value: string;
}

const encoder = new TextEncoder();

/** Encode one TLV field. Throws if the UTF-8 byte length exceeds 255. */
export function encodeTlv(tag: number, value: string): Uint8Array {
  if (tag < 0 || tag > 255) {
    throw new Error(`TLV tag ${tag} must fit in 1 byte (0-255)`);
  }
  const valueBytes = encoder.encode(value ?? "");
  if (valueBytes.length > 255) {
    throw new Error(`TLV value for tag ${tag} exceeds 255 UTF-8 bytes`);
  }
  const out = new Uint8Array(2 + valueBytes.length);
  out[0] = tag;
  out[1] = valueBytes.length;
  out.set(valueBytes, 2);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is available in browsers and Deno. UTF-8 safety is preserved because
  // we operate on a raw byte string.
  return typeof btoa !== "undefined"
    ? btoa(binary)
    : // Fallback (Node-style) - kept defensively for tests.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Buffer.from(bytes).toString("base64");
}

export function tlvTagsFromInput(input: ZatcaQrInput): TlvTag[] {
  return [
    { tag: 1, name: "Seller Name", value: input.sellerName },
    { tag: 2, name: "VAT Registration Number", value: input.vatNumber },
    { tag: 3, name: "Timestamp", value: input.timestamp },
    { tag: 4, name: "Invoice Total Including VAT", value: input.invoiceTotal },
    { tag: 5, name: "VAT Total", value: input.vatTotal },
  ];
}

/** Encode the Phase 1 TLV payload and return Base64. */
export function generateZatcaQrBase64(input: ZatcaQrInput): string {
  const tags = tlvTagsFromInput(input);
  const buffer = concat(tags.map((t) => encodeTlv(t.tag, t.value)));
  return bytesToBase64(buffer);
}

export interface ZatcaValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateZatcaInput(input: Partial<ZatcaQrInput>): ZatcaValidationResult {
  const errors: string[] = [];
  if (!input.sellerName || !input.sellerName.trim()) {
    errors.push("Seller name is missing in ZATCA settings.");
  } else if (encoder.encode(input.sellerName).length > 255) {
    errors.push("Seller name exceeds maximum allowed TLV byte length.");
  }
  if (!input.vatNumber) {
    errors.push("VAT registration number is missing in ZATCA settings.");
  } else if (!/^\d{15}$/.test(input.vatNumber)) {
    errors.push("Invalid VAT registration number. It should be 15 digits.");
  }
  if (!input.timestamp) {
    errors.push("Invoice timestamp is required.");
  }
  const total = Number(input.invoiceTotal);
  if (!input.invoiceTotal || Number.isNaN(total) || total <= 0) {
    errors.push("Invoice total must be greater than zero.");
  }
  const vat = Number(input.vatTotal);
  if (input.vatTotal === undefined || Number.isNaN(vat) || vat < 0) {
    errors.push("VAT total cannot be negative.");
  }
  return { valid: errors.length === 0, errors };
}