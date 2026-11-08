// =====================================================================
// USB (Android OTG) ESC/POS printer adapter - TA-900U & friends
// ---------------------------------------------------------------------
// Talks to a native Capacitor plugin called `ThermalPrinter` that the
// Android app registers (see docs/thermal-printer-ta900u.md). The plugin
// owns the Android UsbManager + UsbDeviceConnection bulkTransfer loop.
//
// On the web (no Capacitor native bridge) this adapter reports as
// unsupported and throws on print so the user is steered to QZ Tray or
// Bluetooth - which keeps `npm run dev` working without the APK.
// =====================================================================

import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PrinterAdapter, PrinterDescriptor, PrintReceiptPayload } from "../types";
import { buildReceiptBytes } from "../escpos";

interface UsbDeviceInfo {
  id: string;          // "vendorId:productId" or device path
  name: string;        // human label, e.g. "TA-900U"
  vendorId: number;
  productId: number;
  hasPermission: boolean;
}

interface ThermalPrinterPlugin {
  /** List connected USB ESC/POS printers. */
  listDevices(): Promise<{ devices: UsbDeviceInfo[] }>;
  /** Trigger the Android USB permission dialog for a device. */
  requestPermission(opts: { deviceId: string }): Promise<{ granted: boolean }>;
  /** Print raw ESC/POS bytes (base64-encoded). */
  printBytes(opts: { deviceId: string; base64: string }): Promise<{ success: boolean }>;
}

const ThermalPrinter = registerPlugin<ThermalPrinterPlugin>("ThermalPrinter");

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  // btoa is available in modern WebViews and browsers.
  return typeof btoa !== "undefined" ? btoa(binary) : "";
}

export class UsbPrinterAdapter implements PrinterAdapter {
  readonly transport = "usb" as const;
  private connectedDeviceId: string | null = null;

  isSupported(): boolean {
    // The plugin only resolves on a Capacitor native platform (Android).
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  }

  async connect(): Promise<void> {
    if (!this.isSupported()) {
      throw new Error(
        "USB printing requires the Matbex Android app. Use Bluetooth or Network/QZ on the web.",
      );
    }
    // No-op connection - the plugin opens the device per-print so that USB
    // permission revocations don't strand a long-lived handle.
  }

  async disconnect(): Promise<void> {
    this.connectedDeviceId = null;
  }

  async listPrinters(): Promise<PrinterDescriptor[]> {
    if (!this.isSupported()) return [];
    try {
      const { devices } = await ThermalPrinter.listDevices();
      return devices.map((d, idx) => ({
        id: d.id,
        name: d.name || `USB Printer ${idx + 1}`,
        transport: "usb" as const,
        isDefault: idx === 0,
        raw: d,
      }));
    } catch {
      return [];
    }
  }

  private async ensurePermission(deviceId: string): Promise<void> {
    const { granted } = await ThermalPrinter.requestPermission({ deviceId });
    if (!granted) {
      throw new Error("USB permission denied for the thermal printer.");
    }
    this.connectedDeviceId = deviceId;
  }

  private async resolveDeviceId(printerId: string | null): Promise<string> {
    if (printerId) return printerId;
    const list = await this.listPrinters();
    if (list.length === 0) throw new Error("No USB thermal printer detected (TA-900U).");
    return list[0].id;
  }

  async printReceipt(printerId: string | null, payload: PrintReceiptPayload): Promise<void> {
    await this.connect();
    const deviceId = await this.resolveDeviceId(printerId);
    if (this.connectedDeviceId !== deviceId) await this.ensurePermission(deviceId);
    const bytes = await buildReceiptBytes(payload);
    const { success } = await ThermalPrinter.printBytes({
      deviceId,
      base64: toBase64(bytes),
    });
    if (!success) throw new Error("USB printer rejected the job.");
  }

  async sendRaw(printerId: string | null, bytes: Uint8Array): Promise<void> {
    await this.connect();
    const deviceId = await this.resolveDeviceId(printerId);
    if (this.connectedDeviceId !== deviceId) await this.ensurePermission(deviceId);
    const { success } = await ThermalPrinter.printBytes({
      deviceId,
      base64: toBase64(bytes),
    });
    if (!success) throw new Error("USB printer rejected raw bytes.");
  }
}