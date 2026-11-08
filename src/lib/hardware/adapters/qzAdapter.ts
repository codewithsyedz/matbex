import type { PrinterAdapter, PrinterDescriptor, PrintReceiptPayload } from "../types";
import { buildReceiptBytes } from "../escpos";
import { getQZ, disconnectQZ } from "../qz";

/**
 * QZ Tray printer adapter - supports USB, Bluetooth and Network printers
 * exposed by the QZ Tray desktop bridge. Sends raw ESC/POS bytes.
 */
export class QZPrinterAdapter implements PrinterAdapter {
  readonly transport = "qz" as const;

  isSupported(): boolean {
    return typeof window !== "undefined";
  }

  async connect(): Promise<void> {
    const api = await getQZ();
    if (!api) throw new Error("QZ Tray is not running on this machine");
  }

  async disconnect(): Promise<void> {
    await disconnectQZ();
  }

  async listPrinters(): Promise<PrinterDescriptor[]> {
    const api = await getQZ();
    if (!api) return [];
    const found = await api.printers.find();
    let defaultName = "";
    try {
      defaultName = await api.printers.getDefault();
    } catch {
      defaultName = "";
    }
    const list = Array.isArray(found) ? found : [found];
    return list.filter(Boolean).map((name) => ({
      id: name,
      name,
      transport: "qz" as const,
      isDefault: name === defaultName,
    }));
  }

  async printReceipt(printerId: string | null, payload: PrintReceiptPayload): Promise<void> {
    const api = await getQZ();
    if (!api) throw new Error("QZ Tray bridge unavailable");
    if (!printerId) throw new Error("No printer selected");
    const config = api.configs.create(printerId, { encoding: "UTF-8" });
    const bytes = await buildReceiptBytes(payload);
    // Convert bytes -> hex string array which QZ accepts as raw data.
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await api.print(config, [{ type: "raw", format: "hex", data: hex }]);
  }

  async sendRaw(printerId: string | null, bytes: Uint8Array): Promise<void> {
    const api = await getQZ();
    if (!api) throw new Error("QZ Tray bridge unavailable");
    if (!printerId) throw new Error("No printer selected");
    const config = api.configs.create(printerId, { encoding: "UTF-8" });
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await api.print(config, [{ type: "raw", format: "hex", data: hex }]);
  }
}