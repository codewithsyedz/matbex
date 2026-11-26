// =====================================================================
// ZATCA persistence helpers
// ---------------------------------------------------------------------
// Wraps the two write paths every completed sale needs:
//   1. Snapshot the seller / VAT / QR / PDF onto sales_transactions
//      (frozen audit fields for reprints & legal requirement).
//   2. Append an immutable row to invoice_generation_logs for every
//      generation attempt (success, failed, or skipped).
// Errors are swallowed and console.warn'd - the audit trail must never
// block the sale itself.
// =====================================================================

import { db } from "@/integrations/db/client";
import type { ZatcaReceiptSnapshot } from "@/lib/printUtils";
import { recordZatcaDocuments } from "@/lib/api/zatca";

export type GenerationStatus = "success" | "failed" | "skipped";
export type GenerationMode = "STRICT" | "SOFT";

export interface UploadPdfArgs {
  restaurantId: string;
  receiptNumber: string;
  /** raw bytes (not base64) */
  pdfBytes: Uint8Array;
}

/** Upload a generated PDF and return its public-ish URL (signed via SDK). */
export async function uploadZatcaPdf(args: UploadPdfArgs): Promise<string | null> {
  try {
    const safeReceipt = args.receiptNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${args.restaurantId}/${new Date().getFullYear()}/${safeReceipt}.pdf`;
    const blob = new Blob([args.pdfBytes as BlobPart], { type: "application/pdf" });
    const { error } = await db.storage
      .from("zatca-receipts")
      .upload(path, blob, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (error) {
      console.warn("[zatca] PDF upload failed:", error.message);
      return null;
    }
    // Bucket is private - produce a long-lived signed URL (1 year).
    const { data: signed } = await db.storage
      .from("zatca-receipts")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    return signed?.signedUrl ?? null;
  } catch (e) {
    console.warn("[zatca] PDF upload threw:", e);
    return null;
  }
}

export interface SnapshotWriteArgs {
  restaurantId: string;
  salesTransactionId: string;
  snapshot: ZatcaReceiptSnapshot;
  pdfUrl: string | null;
  generatedAt?: string;
}

/** Freeze the ZATCA snapshot (and PDF link) onto the sale: POST /api/v1/zatca/sales/:id/documents. */
export async function writeZatcaSnapshot(args: SnapshotWriteArgs): Promise<void> {
  try {
    await recordZatcaDocuments(args.salesTransactionId, {
      restaurantId: args.restaurantId,
      snapshot: {
        sellerName: args.snapshot.sellerName,
        sellerNameAr: args.snapshot.sellerNameAr ?? null,
        vatNumber: args.snapshot.vatNumber,
        timestamp: args.snapshot.timestamp,
        invoiceTotal: args.snapshot.invoiceTotal,
        vatTotal: args.snapshot.vatTotal,
        qrBase64: args.snapshot.qrBase64 ?? null,
      },
      pdfUrl: args.pdfUrl,
    });
  } catch (e) {
    console.warn("[zatca] snapshot write failed:", e);
  }
}

export interface LogGenerationArgs {
  restaurantId: string;
  salesTransactionId: string | null;
  receiptNumber: string;
  status: GenerationStatus;
  mode: GenerationMode;
  snapshot: Pick<
    ZatcaReceiptSnapshot,
    "sellerName" | "vatNumber" | "qrBase64" | "invoiceTotal" | "vatTotal"
  > | null;
  pdfUrl?: string | null;
  pdfBytes?: number | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  triggeredBy?: string | null;
}

export async function logInvoiceGeneration(args: LogGenerationArgs): Promise<void> {
  try {
    const { error } = await db.from("invoice_generation_logs").insert({
      restaurant_id: args.restaurantId,
      sales_transaction_id: args.salesTransactionId,
      receipt_number: args.receiptNumber,
      status: args.status,
      mode: args.mode,
      seller_name: args.snapshot?.sellerName ?? null,
      vat_number: args.snapshot?.vatNumber ?? null,
      qr_base64: args.snapshot?.qrBase64 ?? null,
      pdf_url: args.pdfUrl ?? null,
      pdf_bytes: args.pdfBytes ?? null,
      invoice_total: args.snapshot ? Number(args.snapshot.invoiceTotal) : null,
      vat_total: args.snapshot ? Number(args.snapshot.vatTotal) : null,
      duration_ms: args.durationMs ?? null,
      error_message: args.errorMessage ?? null,
      triggered_by: args.triggeredBy ?? null,
    });
    if (error) console.warn("[zatca] generation log failed:", error.message);
  } catch (e) {
    console.warn("[zatca] generation log threw:", e);
  }
}

/** Decode the base64 PDF returned by the edge function into raw bytes. */
export function pdfBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}