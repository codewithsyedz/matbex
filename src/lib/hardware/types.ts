// =====================================================================
// Hardware abstraction layer - type definitions
// ---------------------------------------------------------------------
// Decouples device logic from React. PrinterAdapter / CashDrawerAdapter
// implementations live in adapters/. Components consume via hooks.
// =====================================================================

export type PrinterTransport =
  | "qz"
  | "browser"
  | "network"
  | "bluetooth"
  | "usb"
  | "webusb"
  | "local-agent";
export type DrawerTransport = "printer" | "serial" | "qz";

export type HardwareConnectionStatus =
  | "unknown"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface PrinterDescriptor {
  /** Stable identifier for the printer. For QZ Tray this is the OS name. */
  id: string;
  name: string;
  transport: PrinterTransport;
  /** True if the OS marks this as the default printer. */
  isDefault?: boolean;
  raw?: unknown;
}

export interface PrintReceiptPayload {
  receiptNumber: string;
  restaurantName: string;
  date: string; // ISO
  cashierName?: string;
  customerName?: string;
  items: Array<{
    name: string;
    size?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  header?: string | null;
  footer?: string | null;
  orderType?: string | null;
  invoiceNumber?: string | null;
  discount?: number | null;
  branding?: {
    logoUrl?: string | null;
    taglineEn?: string | null;
    taglineAr?: string | null;
    addressEn?: string | null;
    addressAr?: string | null;
    branchName?: string | null;
    terminalId?: string | null;
    printerId?: string | null;
    footerMessageEn?: string | null;
    footerMessageAr?: string | null;
    showLogo?: boolean;
    showBranchName?: boolean;
    showDiscountRow?: boolean;
    showItemCount?: boolean;
    showTerminalId?: boolean;
    showPrinterId?: boolean;
    phone?: string | null;
    whatsapp?: string | null;
    instagram?: string | null;
    xHandle?: string | null;
    tiktok?: string | null;
    snapchat?: string | null;
    promoMessageEn?: string | null;
    promoMessageAr?: string | null;
    loyaltyQrUrl?: string | null;
    loyaltyQrLabelEn?: string | null;
    loyaltyQrLabelAr?: string | null;
    reorderQrUrl?: string | null;
    reorderQrLabelEn?: string | null;
    reorderQrLabelAr?: string | null;
    showPhone?: boolean;
    showSocialHandles?: boolean;
    showPromoMessage?: boolean;
    showLoyaltyQr?: boolean;
    showReorderQr?: boolean;
  } | null;
  language?: "ar" | "en";
  /**
   * Visual template used by the print agent renderer.
   *  - simple           — minimal cash receipt (no VAT / no QR)
   *  - tax_invoice      — ZATCA-style simplified tax invoice (default)
   *  - detailed         — full breakdown with cashier / customer / item notes
   *  - saudi_bilingual  — bilingual EN/AR "Simplified Tax Invoice" layout
   *  - zatca_standard   — ZATCA Standard (B2B) invoice with buyer details
   */
  template?: "simple" | "tax_invoice" | "detailed" | "saudi_bilingual" | "zatca_standard";
  /** Optional per-template overrides — language, paper width, toggles, notes. */
  templateConfig?: {
    language?: "en" | "ar" | "bilingual";
    paperWidth?: 58 | 80;
    options?: Record<string, boolean | string | number | null>;
    headerNoteEn?: string | null;
    headerNoteAr?: string | null;
    footerNoteEn?: string | null;
    footerNoteAr?: string | null;
    /** Standard (B2B) buyer block, used by zatca_standard preset. */
    buyer?: {
      name?: string | null;
      vatNumber?: string | null;
      address?: string | null;
      idValue?: string | null;
    } | null;
  };
  /** Open the cash drawer connected to this printer after the receipt prints. */
  openDrawer?: boolean;
  /** ESC/POS drawer kick code, e.g. "27,112,0,25,250" */
  drawerKickCode?: string;
  /**
   * Optional ZATCA Phase-1 snapshot - frozen at sale time so reprints
   * always show the same QR / VAT data even if settings later change.
   */
  zatca?: {
    sellerName: string;
    sellerNameAr?: string | null;
    vatNumber: string;
    crNumber?: string | null;
    timestamp: string;
    invoiceTotal: string;
    vatTotal: string;
    qrBase64?: string | null;
    showQr?: boolean;
  } | null;
}

export type PrintJobStatus =
  | "pending"
  | "printing"
  | "done"
  | "failed"
  | "queued-offline";

export interface PrintJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PrintJobStatus;
  transport: PrinterTransport;
  printerId: string | null;
  payload: PrintReceiptPayload;
  attempts: number;
  lastError?: string | null;
  retryAfter?: string | null;
  /** Retained for "Reprint last receipt" flow. */
  isLast?: boolean;
}

export interface PrinterAdapter {
  readonly transport: PrinterTransport;
  /** True if this adapter can reasonably run in the current environment. */
  isSupported(): boolean;
  /** Resolve once any connection setup completes. Safe to call multiple times. */
  connect(): Promise<void>;
  /** Release resources. */
  disconnect(): Promise<void>;
  /** Discover printers reachable through this transport. */
  listPrinters(): Promise<PrinterDescriptor[]>;
  /** Print a receipt. Throw on failure so the queue can retry. */
  printReceipt(printerId: string | null, payload: PrintReceiptPayload): Promise<void>;
  /** Send raw ESC/POS bytes (used for drawer kick / diagnostics). */
  sendRaw?(printerId: string | null, bytes: Uint8Array): Promise<void>;
}

export interface CashDrawerAdapter {
  readonly transport: DrawerTransport;
  isSupported(): boolean;
  /** Open the drawer. Returns true if the kick was sent. */
  open(opts?: { printerId?: string | null; kickCode?: string }): Promise<boolean>;
}

export interface HardwareConfig {
  preferredTransport: PrinterTransport;
  defaultPrinterId: string | null;
  defaultPrinterName: string | null;
  drawerTransport: DrawerTransport;
  drawerKickCode: string;
  autoOpenDrawerOnCash: boolean;
  /** Network printer host:port (only when preferredTransport === "network") */
  networkHost?: string | null;
  networkPort?: number | null;
}

export const DEFAULT_HARDWARE_CONFIG: HardwareConfig = {
  preferredTransport: "qz",
  defaultPrinterId: null,
  defaultPrinterName: null,
  drawerTransport: "printer",
  drawerKickCode: "27,112,0,25,250",
  autoOpenDrawerOnCash: true,
  networkHost: null,
  networkPort: 9100,
};