// =====================================================================
// ZATCA Phase 2 - invoice hash chaining + UUID
// ---------------------------------------------------------------------
// For every cleared/reported invoice, ZATCA requires:
//   - a per-device monotonically increasing ICV (Invoice Counter Value)
//   - a PIH (Previous Invoice Hash) chained from the prior invoice
//   - a UUID for the document
//   - the invoice hash (base64 SHA-256 of the canonical invoice doc).
//
// We compute a stable hash over a canonical JSON payload of the sale.
// Once we ship the UBL XML generator, this hash will be replaced by the
// SHA-256 of the canonical XML - but the chain itself (DB function +
// device row update) is correct as-is and won't need to change.
// =====================================================================

import type { ZatcaReceiptSnapshot } from "@/lib/printUtils";

function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(sortedStringify).join(",")}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(o[k])}`).join(",")}}`;
}

async function sha256Base64(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export interface ChainInput {
  receiptNumber: string;
  uuid: string;
  snapshot: ZatcaReceiptSnapshot;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
}

export async function computeInvoiceHash(input: ChainInput): Promise<string> {
  const canonical = sortedStringify({
    uuid: input.uuid,
    receipt: input.receiptNumber,
    seller: input.snapshot.sellerName,
    vat: input.snapshot.vatNumber,
    ts: input.snapshot.timestamp,
    sub: input.subtotal.toFixed(2),
    tax: input.tax.toFixed(2),
    total: input.total.toFixed(2),
    pm: input.paymentMethod,
    items: input.items.map((i) => ({
      n: i.name, q: i.quantity, u: i.unitPrice.toFixed(2), t: i.total.toFixed(2),
    })),
  });
  return sha256Base64(canonical);
}

export interface AdvanceChainResult {
  icv: number;
  pih: string;
  invoiceHash: string;
  uuid: string;
}

// ICV/PIH allocation and stamping the sale happen on the server in one transaction:
// stampZatcaChain() in src/lib/api/zatca.ts (POST /api/v1/zatca/sales/:id/chain).
