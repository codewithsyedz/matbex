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

import { supabase } from "@/integrations/supabase/client";
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

/**
 * Allocate the next ICV/PIH for a device, computing the invoice hash and
 * UUID up front. Returns null if no device is registered (caller decides
 * whether to block - STRICT - or proceed without chain - SOFT/Phase 1).
 */
export async function advanceZatcaChain(
  deviceId: string | null,
  input: Omit<ChainInput, "uuid"> & { uuid?: string },
): Promise<AdvanceChainResult | null> {
  if (!deviceId) return null;
  const uuid = input.uuid ?? crypto.randomUUID();
  const invoiceHash = await computeInvoiceHash({ ...input, uuid });
  const { data, error } = await supabase.rpc("next_zatca_chain" as never, {
    _device_id: deviceId,
    _invoice_hash: invoiceHash,
  } as never);
  if (error) throw error;
  if (!data) throw new Error("next_zatca_chain returned no row");
  const row = (Array.isArray(data) ? data[0] : data) as { icv: number; pih: string };
  if (!row) throw new Error("next_zatca_chain returned empty row");
  return { icv: Number(row.icv), pih: row.pih, invoiceHash, uuid };
}

export async function writeZatcaChainToSale(args: {
  salesTransactionId: string;
  deviceId: string;
  chain: AdvanceChainResult;
}): Promise<void> {
  const { error } = await supabase
    .from("sales_transactions")
    .update(({
      zatca_device_id: args.deviceId,
      zatca_uuid: args.chain.uuid,
      zatca_icv: args.chain.icv,
      zatca_pih: args.chain.pih,
      zatca_invoice_hash: args.chain.invoiceHash,
      zatca_clearance_status: "PENDING",
    }) as never)
    .eq("id", args.salesTransactionId);
  if (error) console.warn("[zatca] chain write failed:", error.message);
}