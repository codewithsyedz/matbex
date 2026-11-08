// =====================================================================
// WebUSB ESC/POS printer adapter
// ---------------------------------------------------------------------
// Talks directly to a USB thermal printer (TA-900U or any ESC/POS class
// printer) from Chrome/Edge using the WebUSB API. No native app, no QZ
// Tray helper - just the browser. The user picks the device once via
// navigator.usb.requestDevice() and the grant persists per-origin.
//
// Supported on: Chrome, Edge, Opera on desktop. Not supported on Safari
// or Firefox - isSupported() returns false there and the user is steered
// to QZ Tray / Bluetooth / browser print fallback.
// =====================================================================

import type { PrinterAdapter, PrinterDescriptor, PrintReceiptPayload } from "../types";
import { buildReceiptBytes } from "../escpos";

// ---- Minimal WebUSB type shims (lib.dom doesn't ship these everywhere) ---
interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
}
interface USBEndpoint {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous";
}
interface USBAlternateInterface { endpoints: USBEndpoint[] }
interface USBInterface { interfaceNumber: number; alternates: USBAlternateInterface[] }
interface USBConfiguration { interfaces: USBInterface[] }
interface USBOutTransferResult { status: "ok" | "stall" | "babble" }
type AnyBuffer = ArrayBuffer | ArrayBufferView;
interface USBDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  opened: boolean;
  configuration: USBConfiguration | null;
  configurations: USBConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>;
  releaseInterface(value: number): Promise<void>;
  transferOut(endpointNumber: number, data: AnyBuffer): Promise<USBOutTransferResult>;
}
interface USB {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(opts: { filters: USBDeviceFilter[] }): Promise<USBDevice>;
}
const nav = (typeof navigator !== "undefined" ? (navigator as Navigator & { usb?: USB }) : undefined);

// Common ESC/POS thermal printer vendor IDs - used as filters in the
// WebUSB device picker so the user only sees relevant devices.
const ESCPOS_VENDOR_FILTERS: USBDeviceFilter[] = [
  { vendorId: 0x0416 }, // Winbond / TA-900U family
  { vendorId: 0x04b8 }, // Epson
  { vendorId: 0x0519 }, // Star
  { vendorId: 0x0fe6 }, // ICS Advent (clones)
  { vendorId: 0x1504 }, // Bixolon
  { vendorId: 0x154f }, // Citizen
  { vendorId: 0x1659 }, // SNBC / generic
  { vendorId: 0x20d1 }, // Xprinter / many TA-900 clones
  { vendorId: 0x28e9 }, // Generic ESC/POS
  { vendorId: 0x6868 }, // No-name thermal printers
];

function pickBulkOutEndpoint(device: USBDevice): { interfaceNumber: number; endpoint: number } | null {
  for (const cfg of device.configurations) {
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        for (const ep of alt.endpoints) {
          if (ep.direction === "out" && ep.type === "bulk") {
            return { interfaceNumber: iface.interfaceNumber, endpoint: ep.endpointNumber };
          }
        }
      }
    }
  }
  return null;
}

function deviceKey(d: USBDevice): string {
  return `${d.vendorId.toString(16)}:${d.productId.toString(16)}`;
}

function deviceLabel(d: USBDevice): string {
  return d.productName || d.manufacturerName || `USB Printer ${deviceKey(d)}`;
}

export class WebUSBPrinterAdapter implements PrinterAdapter {
  readonly transport = "webusb" as const;
  private device: USBDevice | null = null;
  private endpoint: number | null = null;
  private interfaceNumber: number | null = null;

  isSupported(): boolean {
    return !!nav?.usb;
  }

  /**
   * Pop the browser USB chooser so the user can grant access to their
   * thermal printer. Call this from a user gesture (button click).
   *
   * @param showAll when true, the picker lists every USB device instead of
   *   only known ESC/POS vendor IDs. Useful for off-list TA-900U clones
   *   and no-name thermal printers whose VID we don't recognise.
   */
  async requestDevice(showAll = false): Promise<PrinterDescriptor | null> {
    if (!nav?.usb) {
      throw new Error("WebUSB is not supported in this browser. Use Chrome or Edge on desktop.");
    }
    // An empty filter object matches every device — that's how WebUSB
    // exposes the "show all" mode.
    const filters = showAll ? [{}] : ESCPOS_VENDOR_FILTERS;
    const device = await nav.usb.requestDevice({ filters });
    await this.openDevice(device);
    return {
      id: deviceKey(device),
      name: deviceLabel(device),
      transport: "webusb",
      isDefault: true,
      raw: { vendorId: device.vendorId, productId: device.productId },
    };
  }

  async connect(): Promise<void> {
    if (!nav?.usb) {
      throw new Error("WebUSB not supported. Use Chrome or Edge desktop.");
    }
    if (this.device && this.device.opened) return;
    // Try to reuse any device the user has previously authorised.
    const granted = await nav.usb.getDevices();
    const match = granted[0];
    if (!match) {
      throw new Error('No USB printer paired yet. Click "Pair USB printer" to choose one.');
    }
    await this.openDevice(match);
  }

  private async openDevice(device: USBDevice): Promise<void> {
    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    const ep = pickBulkOutEndpoint(device);
    if (!ep) throw new Error("No bulk OUT endpoint found on this USB device.");
    try {
      await device.claimInterface(ep.interfaceNumber);
    } catch (e) {
      throw new Error(
        `Could not claim USB interface (${(e as Error).message}). Close any other app using the printer.`,
      );
    }
    this.device = device;
    this.endpoint = ep.endpoint;
    this.interfaceNumber = ep.interfaceNumber;
  }

  async disconnect(): Promise<void> {
    if (!this.device) return;
    try {
      if (this.interfaceNumber !== null) await this.device.releaseInterface(this.interfaceNumber);
      await this.device.close();
    } catch {
      // ignore
    }
    this.device = null;
    this.endpoint = null;
    this.interfaceNumber = null;
  }

  async listPrinters(): Promise<PrinterDescriptor[]> {
    if (!nav?.usb) return [];
    const granted = await nav.usb.getDevices();
    return granted.map((d, idx) => ({
      id: deviceKey(d),
      name: deviceLabel(d),
      transport: "webusb" as const,
      isDefault: idx === 0,
      raw: { vendorId: d.vendorId, productId: d.productId },
    }));
  }

  private async sendBytes(bytes: Uint8Array): Promise<void> {
    await this.connect();
    if (!this.device || this.endpoint === null) {
      throw new Error("USB printer not connected.");
    }
    // Chunk large payloads to play nicely with low-end printer buffers.
    const CHUNK = 4096;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.subarray(i, i + CHUNK);
      const result = await this.device.transferOut(this.endpoint, slice);
      if (result.status !== "ok") {
        throw new Error(`USB transfer status: ${result.status}`);
      }
    }
  }

  async printReceipt(_printerId: string | null, payload: PrintReceiptPayload): Promise<void> {
    const bytes = await buildReceiptBytes(payload);
    await this.sendBytes(bytes);
  }

  async sendRaw(_printerId: string | null, bytes: Uint8Array): Promise<void> {
    await this.sendBytes(bytes);
  }
}