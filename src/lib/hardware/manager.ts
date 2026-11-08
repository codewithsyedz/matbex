// =====================================================================
// HardwareManager - single entry point for printing & cash drawer.
// ---------------------------------------------------------------------
// Picks the right adapter based on the saved HardwareConfig, drains the
// IndexedDB print queue with retries, and re-drains automatically on
// browser refresh and on internet reconnect.
// =====================================================================

import { BrowserPrinterAdapter } from "./adapters/browserAdapter";
import { BluetoothPrinterAdapter } from "./adapters/bluetoothAdapter";
import { NetworkPrinterAdapter } from "./adapters/networkAdapter";
import { QZPrinterAdapter } from "./adapters/qzAdapter";
import { UsbPrinterAdapter } from "./adapters/usbAdapter";
import { WebUSBPrinterAdapter } from "./adapters/webusbAdapter";
import { LocalAgentPrinterAdapter } from "./adapters/localAgentAdapter";
import {
  PrinterCashDrawerAdapter,
  SerialCashDrawerAdapter,
} from "./adapters/drawerAdapters";
import {
  enqueueJob,
  getLastReceipt,
  listJobs,
  nextPending,
  setLastReceipt,
  updateJob,
  deleteJob,
} from "./printQueue";
import { emitConfigChange, HARDWARE_CONFIG_EVENT, loadHardwareConfig, saveHardwareConfig } from "./config";
import type {
  CashDrawerAdapter,
  HardwareConfig,
  PrintJob,
  PrintReceiptPayload,
  PrinterAdapter,
  PrinterDescriptor,
  PrinterTransport,
} from "./types";

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 2_000;

export const PRINT_QUEUE_EVENT = "matbex:print-queue-changed";

function emitQueueChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PRINT_QUEUE_EVENT));
}

class HardwareManager {
  private config: HardwareConfig = loadHardwareConfig();
  private printerAdapter: PrinterAdapter;
  private drawerAdapter: CashDrawerAdapter;
  private draining = false;
  private installed = false;

  private isNonRetryablePrintError(message: string): boolean {
    const normalized = message.toLowerCase();
    return [
      "requires the matbex android app",
      "not supported",
      "no printer selected",
      "host is not configured",
      "permission denied",
      "no usb thermal printer detected",
      "no usb printer paired yet",
      "no bulk out endpoint found",
      "could not claim usb interface",
      "usb printer rejected the job",
      "usb printer rejected raw bytes",
      "local print agent unreachable",
      "local print agent rejected the job",
    ].some((part) => normalized.includes(part));
  }

  constructor() {
    this.printerAdapter = this.buildPrinterAdapter(this.config);
    this.drawerAdapter = this.buildDrawerAdapter(this.config, this.printerAdapter);
  }

  private buildPrinterAdapterForTransport(transport: PrinterTransport): PrinterAdapter {
    if (transport === this.config.preferredTransport) {
      return this.printerAdapter;
    }

    const cfg: HardwareConfig = { ...this.config, preferredTransport: transport };
    return this.buildPrinterAdapter(cfg);
  }

  private refreshAdapters() {
    this.config = loadHardwareConfig();
    this.printerAdapter = this.buildPrinterAdapter(this.config);
    this.drawerAdapter = this.buildDrawerAdapter(this.config, this.printerAdapter);
  }

  install() {
    if (this.installed || typeof window === "undefined") return;
    this.installed = true;
    window.addEventListener("online", () => {
      void this.drainQueue();
    });
    window.addEventListener(HARDWARE_CONFIG_EVENT, () => {
      this.refreshAdapters();
    });
    // Drain any leftover jobs from a previous session.
    void this.drainQueue();
  }

  // ---------------- adapters ----------------
  private buildPrinterAdapter(cfg: HardwareConfig): PrinterAdapter {
    switch (cfg.preferredTransport) {
      case "qz":
        return new QZPrinterAdapter();
      case "network":
        return new NetworkPrinterAdapter(cfg.networkHost ?? null, cfg.networkPort ?? 9100);
      case "local-agent":
        return new LocalAgentPrinterAdapter(
          cfg.networkHost ?? "127.0.0.1",
          cfg.networkPort ?? 9911,
        );
      case "bluetooth":
        return new BluetoothPrinterAdapter();
      case "usb":
        // Native Android (Capacitor) → talk to the TA-900U over USB-OTG.
        // On the web fall back to WebUSB (Chrome/Edge) if available, else
        // QZ Tray which works through its installed helper.
        {
          const usb = new UsbPrinterAdapter();
          if (usb.isSupported()) return usb;
          const webusb = new WebUSBPrinterAdapter();
          if (webusb.isSupported()) return webusb;
          return new QZPrinterAdapter();
        }
      case "webusb":
        return new WebUSBPrinterAdapter();
      case "browser":
      default:
        return new BrowserPrinterAdapter();
    }
  }

  private buildDrawerAdapter(cfg: HardwareConfig, printer: PrinterAdapter): CashDrawerAdapter {
    if (cfg.drawerTransport === "serial") return new SerialCashDrawerAdapter();
    return new PrinterCashDrawerAdapter(printer);
  }

  // ---------------- public API ----------------
  getConfig(): HardwareConfig {
    return this.config;
  }

  updateConfig(patch: Partial<HardwareConfig>) {
    this.config = { ...this.config, ...patch };
    saveHardwareConfig(this.config);
    this.refreshAdapters();
    emitConfigChange();
  }

  getPrinter(): PrinterAdapter {
    return this.printerAdapter;
  }

  async detectPrinters(): Promise<PrinterDescriptor[]> {
    try {
      await this.printerAdapter.connect();
    } catch {
      // ignore - listPrinters may still work or return [].
    }
    return this.printerAdapter.listPrinters();
  }

  /**
   * Print a receipt. Always enqueues - the queue is the source of truth so
   * jobs survive refresh, offline periods and transient device errors.
   */
  async printReceipt(payload: PrintReceiptPayload): Promise<PrintJob> {
    await setLastReceipt(payload);
    const job = await enqueueJob({
      payload,
      transport: this.config.preferredTransport,
      printerId: this.config.defaultPrinterId,
      status: navigator.onLine === false ? "queued-offline" : "pending",
    });
    emitQueueChange();
    void this.drainQueue();
    return job;
  }

  async reprintLast(): Promise<PrintJob | null> {
    const last = await getLastReceipt();
    if (!last) return null;
    return this.printReceipt({ ...last, receiptNumber: `${last.receiptNumber}-RP` });
  }

  /**
   * Recent successfully-printed receipts, newest first. Derived from
   * IndexedDB job history so it survives refreshes.
   */
  async getReceiptHistory(limit = 10): Promise<PrintJob[]> {
    const jobs = await listJobs();
    return jobs
      .filter((j) => j.status === "done")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /**
   * Reprint a specific historical receipt by job id. Re-enqueues a fresh
   * job with an -RP suffix so it shows up as a new entry in the queue.
   */
  async reprintJob(jobId: string): Promise<PrintJob | null> {
    const jobs = await listJobs();
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return null;
    const base = job.payload.receiptNumber.replace(/-RP(\d*)$/, "");
    const existingRp = jobs.filter((j) => j.payload.receiptNumber.startsWith(`${base}-RP`)).length;
    const suffix = existingRp > 0 ? `-RP${existingRp + 1}` : "-RP";
    return this.printReceipt({ ...job.payload, receiptNumber: `${base}${suffix}` });
  }

  /**
   * Wipe successfully-printed receipt history. Pending/failed jobs are kept
   * so we never lose work that hasn't actually printed.
   */
  async clearReceiptHistory(): Promise<number> {
    const jobs = await listJobs();
    const done = jobs.filter((j) => j.status === "done");
    await Promise.all(done.map((j) => deleteJob(j.id)));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PRINT_QUEUE_EVENT));
    return done.length;
  }

  async openDrawer(): Promise<boolean> {
    return this.drawerAdapter.open({
      printerId: this.config.defaultPrinterId,
      kickCode: this.config.drawerKickCode,
    });
  }

  async getQueue(): Promise<PrintJob[]> {
    return listJobs();
  }

  async retryJob(id: string): Promise<void> {
    await updateJob(id, { status: "pending", lastError: null });
    emitQueueChange();
    void this.drainQueue();
  }

  async waitForJobCompletion(id: string, timeoutMs = 12000): Promise<PrintJob | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const jobs = await listJobs();
      const job = jobs.find((item) => item.id === id) ?? null;
      if (!job) return null;
      if (job.status === "done" || job.status === "failed") return job;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const jobs = await listJobs();
    return jobs.find((item) => item.id === id) ?? null;
  }

  // ---------------- queue ----------------
  async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (true) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          // Offline - keep jobs queued; they'll resume when online fires.
          return;
        }
        const job = await nextPending();
        if (!job) return;
        await this.runJob(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runJob(job: PrintJob): Promise<void> {
    await updateJob(job.id, { status: "printing", attempts: job.attempts + 1 });
    emitQueueChange();
    try {
      const printerAdapter = this.buildPrinterAdapterForTransport(job.transport);
      // Make sure the cash drawer kick is part of the receipt for printer-attached drawers.
      const payload: PrintReceiptPayload = {
        ...job.payload,
        drawerKickCode: job.payload.drawerKickCode ?? this.config.drawerKickCode,
        openDrawer:
          job.payload.openDrawer ??
          (this.config.autoOpenDrawerOnCash &&
            this.config.drawerTransport === "printer" &&
            job.payload.paymentMethod.toLowerCase() === "cash"),
      };
      await printerAdapter.printReceipt(job.printerId, payload);
      await updateJob(job.id, { status: "done", lastError: null, retryAfter: null });
      emitQueueChange();

      // Standalone serial drawer kick for cash sales when not via printer.
      if (
        this.config.autoOpenDrawerOnCash &&
        this.config.drawerTransport === "serial" &&
        payload.paymentMethod.toLowerCase() === "cash"
      ) {
        await this.openDrawer().catch(() => null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = job.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS || this.isNonRetryablePrintError(message);
      const wait = BACKOFF_BASE_MS * Math.pow(2, attempts - 1);
      await updateJob(job.id, {
        status: giveUp ? "failed" : "pending",
        lastError: message,
        retryAfter: giveUp ? null : new Date(Date.now() + wait).toISOString(),
      });
      emitQueueChange();
      if (!giveUp) {
        await new Promise((r) => setTimeout(r, wait));
      } else {
        return;
      }
    }
  }
}

export const hardwareManager = new HardwareManager();