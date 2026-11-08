import type { PrinterAdapter, PrinterDescriptor, PrintReceiptPayload } from "../types";
import { buildReceiptBytes } from "../escpos";

/**
 * Network printer adapter - sends ESC/POS bytes via an HTTP bridge.
 * Browsers cannot open raw TCP sockets, so callers must point this at
 * either QZ Tray or a small relay that accepts POSTs to /print.
 */
export class NetworkPrinterAdapter implements PrinterAdapter {
  readonly transport = "network" as const;

  constructor(
    private readonly host: string | null,
    private readonly port: number = 9100,
  ) {}

  isSupported(): boolean {
    return Boolean(this.host);
  }

  async connect(): Promise<void> {
    // no persistent connection from the browser
  }

  async disconnect(): Promise<void> {
    // no-op
  }

  async listPrinters(): Promise<PrinterDescriptor[]> {
    if (!this.host) return [];
    return [
      {
        id: `${this.host}:${this.port}`,
        name: `Network printer (${this.host}:${this.port})`,
        transport: "network",
        isDefault: true,
      },
    ];
  }

  async printReceipt(_printerId: string | null, payload: PrintReceiptPayload): Promise<void> {
    if (!this.host) throw new Error("Network printer host is not configured");
    const bytes = await buildReceiptBytes(payload);
    await this.send(bytes);
  }

  async sendRaw(_printerId: string | null, bytes: Uint8Array): Promise<void> {
    if (!this.host) throw new Error("Network printer host is not configured");
    await this.send(bytes);
  }

  private async send(bytes: Uint8Array): Promise<void> {
    const url = `http://${this.host}:${this.port}/print`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    });
    if (!res.ok) throw new Error(`Network printer responded ${res.status}`);
  }
}