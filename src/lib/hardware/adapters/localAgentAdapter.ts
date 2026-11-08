import type { PrinterAdapter, PrinterDescriptor, PrintReceiptPayload } from "../types";

/**
 * Local Print Agent adapter.
 * Talks to the Matbex local print service (see /print-agent) that runs on
 * the POS machine and forwards raw ESC/POS bytes (with rasterised Arabic)
 * to the connected USB thermal printer. The browser only sends JSON — no
 * print dialog, no driver shenanigans, no Arabic shaping bugs.
 *
 * Default endpoint: http://127.0.0.1:9911/print
 */
export class LocalAgentPrinterAdapter implements PrinterAdapter {
  readonly transport = "local-agent" as const;

  constructor(
    private readonly host: string | null = "127.0.0.1",
    private readonly port: number = 9911,
  ) {}

  private get baseUrl(): string {
    const h = this.host || "127.0.0.1";
    return `http://${h}:${this.port}`;
  }

  isSupported(): boolean {
    return typeof fetch !== "undefined";
  }

  async connect(): Promise<void> {
    // health ping (non-fatal)
    try {
      await fetch(`${this.baseUrl}/health`, { method: "GET" });
    } catch {
      /* ignore — printReceipt surfaces the real error */
    }
  }

  async disconnect(): Promise<void> {
    /* stateless */
  }

  async listPrinters(): Promise<PrinterDescriptor[]> {
    try {
      const res = await fetch(`${this.baseUrl}/printers`);
      if (!res.ok) throw new Error(`agent responded ${res.status}`);
      const data = (await res.json()) as { printers?: Array<{ id?: string; name: string; isDefault?: boolean }> };
      const printers = data.printers ?? [];
      return printers.map((p) => ({
        id: p.id ?? p.name,
        name: p.name,
        transport: "local-agent",
        isDefault: !!p.isDefault,
      }));
    } catch {
      // Agent may not expose /printers — fall back to a single "default" entry.
      return [
        {
          id: "default",
          name: `Local Print Agent (${this.host || "127.0.0.1"}:${this.port})`,
          transport: "local-agent",
          isDefault: true,
        },
      ];
    }
  }

  async printReceipt(printerId: string | null, payload: PrintReceiptPayload): Promise<void> {
    // "default" is the placeholder we surface when the agent has no /printers
    // route — never forward it as a real Windows printer name.
    const printer =
      printerId && printerId.toLowerCase() !== "default" ? printerId : undefined;
    const body = {
      printer,
      openDrawer: !!payload.openDrawer,
      drawerKickCode: payload.drawerKickCode,
      receipt: payload,
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Local Print Agent unreachable at ${this.baseUrl} — is the service running? (${msg})`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Local Print Agent rejected the job (${res.status}): ${text}`);
    }
  }

  async sendRaw(printerId: string | null, bytes: Uint8Array): Promise<void> {
    const printer =
      printerId && printerId.toLowerCase() !== "default" ? printerId : "";
    const qs = printer ? `?printer=${encodeURIComponent(printer)}` : "";
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/raw${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Local Print Agent unreachable at ${this.baseUrl} — is the service running? (${msg})`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Local Print Agent raw send failed (${res.status}): ${text}`);
    }
  }

  /**
   * Fire the cash drawer via the agent's dedicated /kick endpoint, which
   * wraps the pulse with init + dual-pin pulses + feed + cut so Windows
   * actually flushes the spool job to the printer hardware.
   */
  async kickDrawer(printerId: string | null, kickCode?: string): Promise<void> {
    const printer =
      printerId && printerId.toLowerCase() !== "default" ? printerId : undefined;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printer, kickCode }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Local Print Agent unreachable at ${this.baseUrl} — is the service running? (${msg})`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Local Print Agent drawer kick failed (${res.status}): ${text}`);
    }
  }
}