import type { CashDrawerAdapter, PrinterAdapter } from "../types";
import { parseKickCode } from "../escpos";
import { LocalAgentPrinterAdapter } from "./localAgentAdapter";

/**
 * Drawer connected via the receipt printer's RJ11 port. Sends an ESC/POS
 * kick code through whichever printer adapter is active.
 */
export class PrinterCashDrawerAdapter implements CashDrawerAdapter {
  readonly transport = "printer" as const;

  constructor(private readonly printer: PrinterAdapter) {}

  isSupported(): boolean {
    return Boolean(this.printer.sendRaw);
  }

  async open(opts: { printerId?: string | null; kickCode?: string } = {}): Promise<boolean> {
    if (!this.printer.sendRaw) return false;
    // Preferred path: when the underlying printer is the Local Print Agent,
    // use its dedicated /kick endpoint. That wraps init + dual-pin pulses +
    // feed + partial cut so the Windows spooler actually flushes the tiny
    // job to the printer firmware (a bare 5-byte kick is often buffered
    // forever and the drawer pin never fires).
    if (this.printer instanceof LocalAgentPrinterAdapter) {
      await this.printer.kickDrawer(opts.printerId ?? null, opts.kickCode);
      return true;
    }
    // Fallback (network/USB/bluetooth adapters): send init + dual-pin pulses
    // + feed + cut as a single raw job for the same flush guarantee.
    const init = [0x1b, 0x40];
    const custom = opts.kickCode ? Array.from(parseKickCode(opts.kickCode)) : [];
    const pin2 = [0x1b, 0x70, 0x00, 0x32, 0xfa]; // ESC p 0 50 250
    const pin5 = [0x1b, 0x70, 0x01, 0x32, 0xfa]; // ESC p 1 50 250
    const feed = [0x1b, 0x64, 0x01];             // feed 1 line
    const cut = [0x1d, 0x56, 0x01];              // partial cut
    const bytes = new Uint8Array([...init, ...custom, ...pin2, ...pin5, ...feed, ...cut]);
    await this.printer.sendRaw(opts.printerId ?? null, bytes);
    return true;
  }
}

/**
 * Direct serial drawer via the Web Serial API. Only works on Chromium
 * with a user gesture and an explicit port pick.
 */
export class SerialCashDrawerAdapter implements CashDrawerAdapter {
  readonly transport = "serial" as const;

  isSupported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  async open(opts: { kickCode?: string } = {}): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      // @ts-ignore - Web Serial typings vary
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      const writer = port.writable.getWriter();
      await writer.write(parseKickCode(opts.kickCode ?? "27,112,0,25,250"));
      writer.releaseLock();
      await port.close();
      return true;
    } catch {
      return false;
    }
  }
}