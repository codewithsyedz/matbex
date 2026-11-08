import type { PrinterAdapter, PrinterDescriptor, PrintReceiptPayload } from "../types";

/**
 * Fallback adapter that prints via the browser print dialog. No hardware
 * detection - always returns a single virtual printer.
 */
export class BrowserPrinterAdapter implements PrinterAdapter {
  readonly transport = "browser" as const;

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined";
  }

  async connect(): Promise<void> {
    // no-op
  }

  async disconnect(): Promise<void> {
    // no-op
  }

  async listPrinters(): Promise<PrinterDescriptor[]> {
    return [
      {
        id: "browser-default",
        name: "Browser print dialog",
        transport: "browser",
        isDefault: true,
      },
    ];
  }

  async printReceipt(_printerId: string | null, payload: PrintReceiptPayload): Promise<void> {
    const { generateReceiptHTML, printViaBrowser, receiptPayloadToData } = await import("@/lib/printUtils");
    const html = await generateReceiptHTML(receiptPayloadToData(payload));
    await printViaBrowser(html);
  }
}