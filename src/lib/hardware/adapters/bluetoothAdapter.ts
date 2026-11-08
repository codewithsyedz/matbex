import type { PrinterAdapter, PrinterDescriptor, PrintReceiptPayload } from "../types";
import { buildReceiptBytes } from "../escpos";

// Common ESC/POS Bluetooth printer service & characteristic UUIDs
const SERVICE_UUID = 0x18f0;
const CHARACTERISTIC_UUID = 0x2af1;
const CHUNK_SIZE = 100;

/**
 * Web Bluetooth ESC/POS adapter. Pairs once via the chooser; the device
 * descriptor is cached on `this` for subsequent prints in the session.
 * Pairing must happen from a user gesture; reconnecting after refresh
 * requires the user to re-pair (browser limitation).
 */
export class BluetoothPrinterAdapter implements PrinterAdapter {
  readonly transport = "bluetooth" as const;
  private device: any = null;
  private characteristic: any = null;

  isSupported(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  async connect(): Promise<void> {
    if (!this.isSupported()) throw new Error("Web Bluetooth not supported");
    if (this.characteristic) return;
    // @ts-ignore - Web Bluetooth typings vary per browser
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    this.device = device;
  }

  async disconnect(): Promise<void> {
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // ignore
    }
    this.device = null;
    this.characteristic = null;
  }

  async listPrinters(): Promise<PrinterDescriptor[]> {
    if (!this.device) return [];
    return [
      {
        id: this.device.id ?? "bt-printer",
        name: this.device.name ?? "Bluetooth printer",
        transport: "bluetooth",
        isDefault: true,
      },
    ];
  }

  async printReceipt(_printerId: string | null, payload: PrintReceiptPayload): Promise<void> {
    await this.connect();
    await this.write(await buildReceiptBytes(payload));
  }

  async sendRaw(_printerId: string | null, bytes: Uint8Array): Promise<void> {
    await this.connect();
    await this.write(bytes);
  }

  private async write(bytes: Uint8Array): Promise<void> {
    if (!this.characteristic) throw new Error("Bluetooth printer not paired");
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.slice(i, i + CHUNK_SIZE);
      await this.characteristic.writeValueWithoutResponse(chunk);
    }
  }
}