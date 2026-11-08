// =====================================================================
// ZATCA receipt service (client side)
// ---------------------------------------------------------------------
// Single source of truth for turning a finalized sale into:
//   1. A ZATCA snapshot (frozen seller/VAT/totals + Phase-1 TLV QR)
//   2. A call to the `generate-zatca-receipt` edge function for a PDF
//
// The same snapshot drives the printed, digital, and PDF receipts so
// they never disagree.
// =====================================================================

import { db } from "@/integrations/db/client";
import {
  generateZatcaQrBase64,
  validateZatcaInput,
  type ZatcaQrInput,
} from "@/lib/zatca/tlv";
import type { ZatcaSettings } from "@/hooks/useZatcaSettings";
import type { ZatcaReceiptSnapshot } from "@/lib/printUtils";

export interface SaleTotalsForReceipt {
  subtotal: number;
  tax: number;
  total: number;
  /** ISO 8601 - defaults to now when omitted. */
  timestamp?: string;
}

function toMoney(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Build a ZATCA snapshot from active settings + sale totals.
 * Returns null if QR is disabled or required settings are missing
 * (in SOFT mode this should be treated as "no QR"; STRICT callers
 * should check `validateZatcaInput` separately).
 */
export function buildZatcaSnapshot(
  settings: ZatcaSettings | null,
  totals: SaleTotalsForReceipt,
  showOn: "printed" | "digital",
): ZatcaReceiptSnapshot | null {
  if (!settings || !settings.qr_enabled) return null;
  const sellerName =
    (settings.seller_name_en || settings.seller_name_ar || "").trim();
  const vatNumber = (settings.vat_registration_number || "").trim();
  if (!sellerName || !/^\d{15}$/.test(vatNumber)) return null;

  const timestamp = totals.timestamp ?? new Date().toISOString();
  const input: ZatcaQrInput = {
    sellerName,
    vatNumber,
    timestamp,
    invoiceTotal: toMoney(totals.total),
    vatTotal: toMoney(totals.tax),
  };

  const showQr =
    showOn === "printed"
      ? settings.show_on_printed_receipt
      : settings.show_on_digital_receipt;

  let qrBase64: string | null = null;
  try {
    qrBase64 = generateZatcaQrBase64(input);
  } catch (e) {
    console.warn("ZATCA QR encoding failed", e);
  }

  return {
    sellerName,
    sellerNameAr: settings.seller_name_ar,
    vatNumber,
    crNumber: settings.cr_number ?? null,
    timestamp,
    invoiceTotal: input.invoiceTotal,
    vatTotal: input.vatTotal,
    qrBase64,
    showQr,
  };
}

export interface GenerateZatcaPdfInput {
  receiptNumber: string;
  date: string; // ISO
  cashierName?: string | null;
  customerName?: string | null;
  paymentMethod: string;
  header?: string | null;
  footer?: string | null;
  currencySymbol?: string | null;
  items: Array<{
    name: string;
    size?: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  zatca: ZatcaReceiptSnapshot;
  mode?: "STRICT" | "SOFT";
}

export interface GenerateZatcaPdfResult {
  /** Base64-encoded PDF bytes */
  pdf: string;
  /** Echoed Base64 TLV QR payload */
  qrBase64: string | null;
  bytes: number;
}

/**
 * Invoke the `generate-zatca-receipt` edge function.
 * Throws a typed Error on failure (caller decides how to surface it).
 */
export async function generateZatcaPdf(
  input: GenerateZatcaPdfInput,
): Promise<GenerateZatcaPdfResult> {
  // Pre-flight validation so we don't waste a function call on a clearly
  // broken snapshot. Edge function performs the same checks server-side.
  const v = validateZatcaInput({
    sellerName: input.zatca.sellerName,
    vatNumber: input.zatca.vatNumber,
    timestamp: input.zatca.timestamp,
    invoiceTotal: input.zatca.invoiceTotal,
    vatTotal: input.zatca.vatTotal,
  });
  if (!v.valid) {
    throw new Error(`ZATCA validation failed: ${v.errors.join("; ")}`);
  }

  const { data, error } = await db.functions.invoke(
    "generate-zatca-receipt",
    {
      body: input,
    },
  );
  if (error) throw error;
  const result = data as GenerateZatcaPdfResult & { error?: string };
  if (result?.error) throw new Error(result.error);
  return result;
}

/**
 * Convenience: turn a base64 PDF into a downloadable Blob URL.
 * Caller is responsible for `URL.revokeObjectURL`.
 */
export function pdfBase64ToBlobUrl(base64: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}