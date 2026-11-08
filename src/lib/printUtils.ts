import { format } from "date-fns";
import QRCode from "qrcode";
import { hardwareManager } from "./hardware/manager";
import type { PrintJob, PrintReceiptPayload } from "./hardware/types";
import { renderHtmlToImageDataUrl } from "./printRaster";
import { roundMoney, netFromListed, grossFromListed, formatMoneyAmount } from "./vatInclusive";

/**
 * ZATCA Phase 1 snapshot - captured at sale-completion time and frozen on
 * the receipt so historical receipts remain reproducible regardless of
 * later settings changes.
 */
export interface ZatcaReceiptSnapshot {
  sellerName: string;
  sellerNameAr?: string | null;
  vatNumber: string;
  /** Commercial Registration (السجل التجاري) - optional. */
  crNumber?: string | null;
  /** ISO 8601 */
  timestamp: string;
  /** Decimal string with 2 fraction digits, e.g. "115.00" */
  invoiceTotal: string;
  /** Decimal string with 2 fraction digits, e.g. "15.00" */
  vatTotal: string;
  /** Pre-computed Base64 TLV payload - used to render the QR locally. */
  qrBase64?: string | null;
  /** Toggle: render QR on this receipt copy. */
  showQr?: boolean;
}

export interface ReceiptData {
  restaurantName: string;
  receiptNumber: string;
  date: Date;
  items: {
    name: string;
    size?: string;
    quantity: number;
    price: number;
    total: number;
  }[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  cashierName?: string;
  customerName?: string;
  header?: string;
  footer?: string;
  zatca?: ZatcaReceiptSnapshot | null;
  /** Optional dine-in / takeaway label (e.g. "محلي" / "سفري"). */
  orderType?: string | null;
  /** Optional separate invoice number - defaults to receiptNumber. */
  invoiceNumber?: string | null;
  /** Optional discount applied before tax. */
  discount?: number | null;
  /** Branding (logo, tagline, branch). All optional - receipt renders without them. */
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
    // Engagement / contact (2026-05)
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
  /** "ar" → RTL Arabic layout, "en" → LTR English. Defaults to "ar". */
  language?: "ar" | "en";
  /**
   * Standard VAT percentage used for this sale (e.g. 15). Prices are
   * VAT-inclusive, so this drives the per-line net/VAT breakdown.
   */
  vatRatePercent?: number;
  /**
   * Branch pricing mode. true (default) = the item prices already include
   * VAT; false = prices are net and VAT is added on top.
   */
  pricesVatInclusive?: boolean;
}

export interface KitchenOrderData {
  orderNumber: string;
  date: Date;
  items: {
    name: string;
    size?: string;
    quantity: number;
    notes?: string;
  }[];
  tableNumber?: string;
  priority?: "normal" | "rush";
  /** Header shown at top of the ticket, e.g. "KITCHEN" or "BAR". */
  stationLabel?: string;
}

export interface PrinterSettings {
  type: "browser" | "network" | "bluetooth";
  ip?: string;
  port?: number;
  name?: string;
}

type TemplatePreset =
  | "simple"
  | "tax_invoice"
  | "detailed"
  | "saudi_bilingual"
  | "zatca_standard";

type TemplateConfig = NonNullable<PrintReceiptPayload["templateConfig"]>;

type ManagedReceiptSettings = {
  receiptPrinterType: "browser" | "network" | "bluetooth" | "usb" | "local-agent";
  receiptPrinterIp?: string;
  receiptPrinterPort?: number;
  openDrawer?: boolean;
  drawerKickCode?: string;
  template?: TemplatePreset;
  templateConfig?: TemplateConfig;
};

function toPrintReceiptPayload(
  data: ReceiptData,
  openDrawer = false,
  drawerKickCode?: string,
  template?: TemplatePreset,
  templateConfig?: TemplateConfig,
): PrintReceiptPayload {
  return {
    receiptNumber: data.receiptNumber,
    restaurantName: data.restaurantName,
    date: data.date.toISOString(),
    cashierName: data.cashierName,
    customerName: data.customerName,
    items: data.items.map((item) => ({
      name: item.name,
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.price,
      total: item.total,
    })),
    subtotal: data.subtotal,
    tax: data.tax,
    total: data.total,
    paymentMethod: data.paymentMethod,
    header: data.header,
    footer: data.footer,
    orderType: data.orderType,
    invoiceNumber: data.invoiceNumber,
    discount: data.discount,
    branding: data.branding,
    language: data.language,
    openDrawer,
    drawerKickCode,
    template,
    templateConfig,
    zatca: data.zatca
      ? {
          sellerName: data.zatca.sellerName,
          sellerNameAr: data.zatca.sellerNameAr,
          vatNumber: data.zatca.vatNumber,
          crNumber: data.zatca.crNumber,
          timestamp: data.zatca.timestamp,
          invoiceTotal: data.zatca.invoiceTotal,
          vatTotal: data.zatca.vatTotal,
          qrBase64: data.zatca.qrBase64,
          showQr: data.zatca.showQr,
        }
      : null,
  };
}

export async function queueReceiptPrint(
  receiptData: ReceiptData,
  settings: ManagedReceiptSettings,
): Promise<PrintJob> {
  const current = hardwareManager.getConfig();
  const isLocalAgent = settings.receiptPrinterType === "local-agent";
  const defaultPort = isLocalAgent ? 9911 : 9100;
  // If the user previously saved port 9100 for a network printer and then
  // switched the receipt printer type to "local-agent", force the agent's
  // default port (9911) instead of trying to POST to a raw 9100 socket.
  const resolvedPort =
    settings.receiptPrinterPort && settings.receiptPrinterPort !== (isLocalAgent ? 9100 : 9911)
      ? settings.receiptPrinterPort
      : current.networkPort && current.networkPort !== (isLocalAgent ? 9100 : 9911)
        ? current.networkPort
        : defaultPort;
  hardwareManager.updateConfig({
    ...current,
    preferredTransport: settings.receiptPrinterType,
    networkHost: settings.receiptPrinterIp ?? current.networkHost ?? (isLocalAgent ? "127.0.0.1" : null),
    networkPort: resolvedPort,
  });

  return hardwareManager.printReceipt(
    toPrintReceiptPayload(
      receiptData,
      settings.openDrawer ?? false,
      settings.drawerKickCode,
      settings.template,
      settings.templateConfig,
    ),
  );
}

export function receiptPayloadToData(payload: PrintReceiptPayload): ReceiptData {
  return {
    receiptNumber: payload.receiptNumber,
    restaurantName: payload.restaurantName,
    date: new Date(payload.date),
    cashierName: payload.cashierName,
    customerName: payload.customerName,
    items: payload.items.map((item) => ({
      name: item.name,
      size: item.size,
      quantity: item.quantity,
      price: item.unitPrice,
      total: item.total,
    })),
    subtotal: payload.subtotal,
    tax: payload.tax,
    total: payload.total,
    paymentMethod: payload.paymentMethod,
    header: payload.header ?? undefined,
    footer: payload.footer ?? undefined,
    orderType: payload.orderType,
    invoiceNumber: payload.invoiceNumber,
    discount: payload.discount,
    branding: payload.branding ?? null,
    language: payload.language,
    zatca: payload.zatca
      ? {
          sellerName: payload.zatca.sellerName,
          sellerNameAr: payload.zatca.sellerNameAr,
          vatNumber: payload.zatca.vatNumber,
          crNumber: payload.zatca.crNumber,
          timestamp: payload.zatca.timestamp,
          invoiceTotal: payload.zatca.invoiceTotal,
          vatTotal: payload.zatca.vatTotal,
          qrBase64: payload.zatca.qrBase64,
          showQr: payload.zatca.showQr,
        }
      : null,
  };
}

/**
 * Render the canonical receipt HTML. Used for printed receipts, the
 * digital receipt preview, and as a fallback for the PDF generator.
 * If a ZATCA snapshot is provided with a QR payload, the QR is rendered
 * inline as a PNG data URL so it survives the new-window print pipeline.
 */
export async function generateReceiptHTML(data: ReceiptData): Promise<string> {
  // ZATCA-compliant thermal receipt - bilingual (Arabic RTL / English LTR).
  // Layout: logo + tagline → address → VAT + CR → bordered order # →
  // meta row (time | date | cashier) → items table → subtotal/discount/VAT
  // → bold TOTAL → payment → invoice/terminal/printer footer → thank-you
  // → QR → reference + CR at bottom.
  const lang: "ar" | "en" = data.language === "en" ? "en" : "ar";
  const isAr = lang === "ar";
  const dir = isAr ? "rtl" : "ltr";
  const b = data.branding ?? {};
  const t = isAr
    ? {
        order: "الطلب",
        cashier: "محصل",
        item: "الصنف",
        qty: "الكمية",
        unitPrice: "السعر",
        total: "الإجمالي",
        subtotal: "الإجمالي الفرعي",
        discount: "الخصم",
        vat: "ضريبة القيمة المضافة",
        net: "الصافي",
        vatShort: "الضريبة",
        gross: "شامل الضريبة",
        grandTotal: "الإجمالي",
        payment: "طريقة الدفع",
        invoice: "الفاتورة",
        printer: "الطابعة",
        terminal: "رقم الجهاز",
        printedAt: "وقت الطباعة",
        vatNo: "الرقم الضريبي",
        crNo: "السجل التجاري",
        thanks: "شكراً لزيارتكم",
        reference: "الرقم المرجعي",
        itemCount: "عدد المنتجات",
        phone: "هاتف",
        whatsapp: "واتساب",
        followUs: "تابعونا",
        scanToJoin: "امسح للانضمام",
        scanToReorder: "امسح لإعادة الطلب",
        offer: "عرض خاص",
      }
    : {
        order: "Order",
        cashier: "Cashier",
        item: "Item",
        qty: "Qty",
        unitPrice: "Unit Price",
        total: "Total",
        subtotal: "Subtotal",
        discount: "Discount",
        vat: "VAT",
        net: "Net",
        vatShort: "VAT",
        gross: "Gross",
        grandTotal: "TOTAL",
        payment: "Payment Method",
        invoice: "Invoice #",
        printer: "Printer",
        terminal: "Terminal",
        printedAt: "Printed At",
        vatNo: "VAT No.",
        crNo: "CR No.",
        thanks: "Thank you for your visit",
        reference: "Reference No.",
        itemCount: "Items",
        phone: "Phone",
        whatsapp: "WhatsApp",
        followUs: "Follow us",
        scanToJoin: "Scan to join",
        scanToReorder: "Scan to re-order",
        offer: "Special offer",
      };

  // Per-line net/VAT/gross breakdown, honouring the branch pricing mode
  // (inclusive → back VAT out of the price, exclusive → add it on top).
  const vatRatePct =
    typeof data.vatRatePercent === "number" && isFinite(data.vatRatePercent)
      ? data.vatRatePercent
      : 15;
  const vatRateLabel = `${(Math.round(vatRatePct * 10) / 10).toFixed(1)}%`;
  const vatFraction = vatRatePct / 100;
  const pricesInclusive = data.pricesVatInclusive !== false;

  const itemsHTML = data.items
    .map(
      (item) => {
        const name = `${item.name}${item.size ? ` (${item.size})` : ""}`;
        const listed = roundMoney(Number(item.total) || 0);
        const gross =
          vatFraction > 0 ? grossFromListed(listed, vatFraction, pricesInclusive) : listed;
        const net =
          vatFraction > 0 ? netFromListed(listed, vatFraction, pricesInclusive) : listed;
        const lineVat = roundMoney(gross - net);
        const cells = [
          `<td class="c-name">${name}</td>`,
          `<td class="c-qty">${item.quantity}</td>`,
          `<td class="c-unit">${formatPrice(item.price)}</td>`,
          `<td class="c-total">${formatPrice(gross)}</td>`,
        ];
        const breakdown = `<tr class="line-breakdown"><td colspan="4" class="c-breakdown">${t.net}: ${formatPrice(net)} · ${t.vatShort} ${vatRateLabel}: ${formatPrice(lineVat)} · ${t.gross}: ${formatPrice(gross)}</td></tr>`;
        return `<tr>${(isAr ? cells.reverse() : cells).join("")}</tr>${breakdown}`;
      },
    )
    .join("");

  const itemCount = data.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

  let qrBlock = "";
  if (data.zatca?.showQr && data.zatca.qrBase64) {
    try {
      const qrDataUrl = await QRCode.toDataURL(data.zatca.qrBase64, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 360,
      });
      qrBlock = `
        <div class="zatca">
          <img src="${qrDataUrl}" alt="ZATCA QR" width="190" height="190" />
        </div>
      `;
    } catch (e) {
      console.warn("Failed to render ZATCA QR for receipt", e);
    }
  }

  // Helper: render an arbitrary URL into a small PNG QR data URL.
  async function makeQr(url: string): Promise<string | null> {
    try {
      return await QRCode.toDataURL(url, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 220,
      });
    } catch (e) {
      console.warn("QR encode failed", e);
      return null;
    }
  }

  const showLoyaltyQr = (b.showLoyaltyQr ?? false) && !!b.loyaltyQrUrl;
  const showReorderQr = (b.showReorderQr ?? false) && !!b.reorderQrUrl;
  const loyaltyQrUrlData = showLoyaltyQr ? await makeQr(b.loyaltyQrUrl as string) : null;
  const reorderQrUrlData = showReorderQr ? await makeQr(b.reorderQrUrl as string) : null;

  const loyaltyLabel = isAr
    ? (b.loyaltyQrLabelAr || t.scanToJoin)
    : (b.loyaltyQrLabelEn || t.scanToJoin);
  const reorderLabel = isAr
    ? (b.reorderQrLabelAr || t.scanToReorder)
    : (b.reorderQrLabelEn || t.scanToReorder);

  const extraQrCount =
    (loyaltyQrUrlData ? 1 : 0) + (reorderQrUrlData ? 1 : 0);
  let extraQrBlock = "";
  if (extraQrCount > 0) {
    const cells: string[] = [];
    if (loyaltyQrUrlData) {
      cells.push(`
        <div class="extra-qr">
          <img src="${loyaltyQrUrlData}" alt="Loyalty QR" width="110" height="110" />
          <div class="extra-qr-label">${loyaltyLabel}</div>
        </div>
      `);
    }
    if (reorderQrUrlData) {
      cells.push(`
        <div class="extra-qr">
          <img src="${reorderQrUrlData}" alt="Re-order QR" width="110" height="110" />
          <div class="extra-qr-label">${reorderLabel}</div>
        </div>
      `);
    }
    extraQrBlock = `<div class="extra-qr-row">${cells.join("")}</div>`;
  }

  // Phone & social handles row
  const showPhone = (b.showPhone ?? true) && !!b.phone;
  const showSocial = (b.showSocialHandles ?? true);
  const socialBits: string[] = [];
  if (showSocial && b.instagram) socialBits.push(`📷 @${(b.instagram as string).replace(/^@+/, "")}`);
  if (showSocial && b.xHandle) socialBits.push(`𝕏 @${(b.xHandle as string).replace(/^@+/, "")}`);
  if (showSocial && b.tiktok) socialBits.push(`♪ @${(b.tiktok as string).replace(/^@+/, "")}`);
  if (showSocial && b.snapchat) socialBits.push(`👻 @${(b.snapchat as string).replace(/^@+/, "")}`);
  if (b.showSocialHandles !== false && b.whatsapp) socialBits.push(`🟢 ${b.whatsapp}`);

  const contactBlock = (showPhone || socialBits.length > 0) ? `
    <div class="contact-block">
      ${showPhone ? `<div class="contact-row">📞 ${t.phone}: <span dir="ltr">${b.phone}</span></div>` : ""}
      ${socialBits.length > 0 ? `<div class="contact-row social">${socialBits.join("  •  ")}</div>` : ""}
    </div>
  ` : "";

  // Promo banner (above QRs)
  const promoText = isAr ? b.promoMessageAr : b.promoMessageEn;
  const showPromo = (b.showPromoMessage ?? false) && !!promoText;
  const promoBlock = showPromo ? `
    <div class="promo-banner">
      <div class="promo-label">★ ${t.offer} ★</div>
      <div class="promo-text">${promoText}</div>
    </div>
  ` : "";

  const invoiceNo = data.invoiceNumber || data.receiptNumber;
  const timeStr = format(data.date, "hh:mm a");
  const dateStr = format(data.date, "dd/MM/yyyy");
  const printedAtStr = format(data.date, "hh:mm a dd/MM/yyyy");

  const subtotal = Number(data.subtotal ?? 0);
  const tax = Number(data.tax ?? 0);
  const total = Number(data.total ?? 0);
  const discount = Number(data.discount ?? 0);

  const showLogo = (b.showLogo ?? true) && !!b.logoUrl;
  const showBranch = (b.showBranchName ?? true) && !!b.branchName;
  const showDiscount = (b.showDiscountRow ?? true);
  const showItemCount = (b.showItemCount ?? true);
  const showTerminal = (b.showTerminalId ?? true) && !!b.terminalId;
  const showPrinter = (b.showPrinterId ?? true) && !!b.printerId;

  const tagline = isAr ? b.taglineAr : b.taglineEn;
  const address = isAr ? b.addressAr : b.addressEn;
  const customFooter = isAr ? b.footerMessageAr : b.footerMessageEn;

  return `
    <!DOCTYPE html>
    <html dir="${dir}" lang="${lang}">
    <head>
      <meta charset="UTF-8" />
      <title>Receipt - ${data.receiptNumber}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: ${isAr ? "'Tahoma', 'Arial', sans-serif" : "'Helvetica Neue', 'Arial', sans-serif"};
          width: 80mm;
          padding: 10px 8px;
          font-size: 12px;
          line-height: 1.45;
          color: #000;
          direction: ${dir};
        }
        .header { text-align: center; margin-bottom: 6px; }
        .logo { max-width: 70%; max-height: 70px; margin: 0 auto 6px; display: block; object-fit: contain; }
        .tagline { font-size: 10px; color: #333; letter-spacing: 0.4px; margin-bottom: 6px; }
        .restaurant-name { font-size: 16px; font-weight: 700; margin: 4px 0; }
        .branch { font-size: 12px; color: #222; margin-bottom: 2px; }
        .address { font-size: 10px; color: #333; margin: 2px 0; line-height: 1.35; }
        .ids { font-size: 10px; color: #222; margin-top: 2px; }
        .ids div { padding: 1px 0; }
        .dashed { border-top: 1px dashed #444; margin: 8px 0; }
        .order-box {
          border: 1.5px solid #000;
          border-radius: 6px;
          padding: 6px 14px;
          margin: 6px auto 8px;
          font-size: 15px;
          font-weight: 700;
          display: inline-block;
          min-width: 55%;
          text-align: center;
        }
        .meta-line {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          padding: 4px 0;
          color: #111;
        }
        .meta-line .sep { color: #888; }
        .custom-header { font-size: 10px; margin: 6px 0; white-space: pre-wrap; text-align: center; }
        table.items {
          width: 100%;
          border-collapse: collapse;
          margin: 4px 0;
          font-size: 11.5px;
        }
        table.items thead th {
          padding: 6px 2px;
          font-weight: bold;
          text-align: ${isAr ? "right" : "left"};
          color: #111;
        }
        table.items td { padding: 4px 2px; vertical-align: top; }
        table.items tr.line-breakdown td.c-breakdown {
          padding: 0 2px 4px;
          font-size: 10px;
          opacity: 0.75;
          text-align: ${isAr ? "right" : "left"};
        }
        .c-name { width: 40%; text-align: ${isAr ? "right" : "left"}; }
        .c-qty  { width: 14%; text-align: center; }
        .c-unit { width: 22%; text-align: ${isAr ? "left" : "right"}; direction: ltr; }
        .c-total{ width: 24%; text-align: ${isAr ? "left" : "right"}; direction: ltr; font-weight: 600; }
        .totals { margin: 4px 0; }
        .totals-row {
          display: flex;
          justify-content: space-between;
          padding: 3px 0;
          font-size: 11.5px;
        }
        .totals-row .amount { direction: ltr; }
        .total-line {
          font-weight: 700;
          font-size: 14px;
          background: #f3f3f3;
          padding: 8px 6px;
          margin-top: 6px;
          border-radius: 2px;
        }
        .payment-row { display: flex; justify-content: space-between; padding: 6px 2px; font-size: 11.5px; }
        .footer-meta {
          display: flex;
          justify-content: space-between;
          padding: 3px 0;
          font-size: 10.5px;
          color: #222;
        }
        .item-count { text-align: center; font-size: 10.5px; color: #444; margin: 4px 0 2px; }
        .thanks { text-align: center; font-size: 11.5px; margin: 10px 0 6px; line-height: 1.5; }
        .zatca { text-align: center; margin: 8px 0 6px; }
        .zatca img { display: block; margin: 0 auto; }
        .extra-qr-row {
          display: flex;
          justify-content: center;
          gap: 14px;
          margin: 8px 0 4px;
        }
        .extra-qr { text-align: center; }
        .extra-qr img { display: block; margin: 0 auto 3px; }
        .extra-qr-label { font-size: 10px; color: #222; font-weight: 600; }
        .contact-block {
          text-align: center;
          font-size: 10.5px;
          color: #222;
          margin: 6px 0 2px;
          line-height: 1.55;
        }
        .contact-row { padding: 1px 0; }
        .contact-row.social { letter-spacing: 0.3px; }
        .promo-banner {
          margin: 8px 0 4px;
          padding: 8px 6px;
          border: 1.5px dashed #000;
          border-radius: 4px;
          text-align: center;
        }
        .promo-label { font-size: 10px; font-weight: 700; letter-spacing: 1px; margin-bottom: 3px; }
        .promo-text { font-size: 11.5px; font-weight: 600; line-height: 1.4; }
        .qr-ids { text-align: center; font-size: 10px; margin-top: 4px; color: #222; }
        .qr-ids div { padding: 1px 0; }
        @media print {
          body { width: 80mm; margin: 0; }
          @page { size: 80mm auto; margin: 0; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        ${showLogo ? `<img class="logo" src="${b.logoUrl}" alt="logo" />` : ""}
        ${tagline ? `<div class="tagline">${tagline}</div>` : ""}
        <div class="restaurant-name">${isAr && data.zatca?.sellerNameAr ? data.zatca.sellerNameAr : data.restaurantName}</div>
        ${showBranch ? `<div class="branch">${b.branchName}</div>` : ""}
        ${address ? `<div class="address">📍 ${address}</div>` : ""}
        ${data.zatca ? `
          <div class="ids">
            <div>${t.vatNo}: ${data.zatca.vatNumber}</div>
            ${data.zatca.crNumber ? `<div>${t.crNo}: ${data.zatca.crNumber}</div>` : ""}
          </div>
        ` : ""}
        ${data.header ? `<div class="custom-header">${data.header}</div>` : ""}
        <div class="dashed"></div>
        <div class="order-box">${t.order} # ${data.receiptNumber}</div>
      </div>

      <div class="meta-line">
        <span>🕐 ${timeStr}</span>
        <span class="sep">|</span>
        <span>📅 ${dateStr}</span>
        <span class="sep">|</span>
        <span>👤 ${t.cashier}: ${data.cashierName || (data.orderType || (isAr ? "محلي" : "Local"))}</span>
      </div>
      <div class="dashed"></div>

      <table class="items">
        <thead>
          <tr>
            ${(() => {
              const headers = [
                `<th class="c-name">${t.item}</th>`,
                `<th class="c-qty">${t.qty}</th>`,
                `<th class="c-unit">${t.unitPrice}</th>`,
                `<th class="c-total">${t.total}</th>`,
              ];
              return (isAr ? headers.reverse() : headers).join("");
            })()}
          </tr>
        </thead>
        <tbody>
          ${itemsHTML}
        </tbody>
      </table>
      <div class="dashed"></div>

      <div class="totals">
        <div class="totals-row">
          <span>${t.subtotal}</span>
          <span class="amount">${formatPrice(subtotal)}</span>
        </div>
        ${showDiscount ? `
        <div class="totals-row">
          <span>${t.discount}</span>
          <span class="amount">${formatPrice(discount)}</span>
        </div>` : ""}
        ${tax > 0 ? `
        <div class="totals-row">
          <span>${t.vat} (${vatRateLabel})</span>
          <span class="amount">${formatPrice(tax)}</span>
        </div>` : ""}
        <div class="totals-row total-line">
          <span>${t.grandTotal}</span>
          <span class="amount">${formatPrice(total)}</span>
        </div>
      </div>
      <div class="dashed"></div>

      <div class="payment-row">
        <span>${t.payment}: ${data.paymentMethod} 💳</span>
      </div>
      <div class="dashed"></div>

      <div class="footer-meta">
        <span>${t.invoice}: ${invoiceNo}</span>
        ${showPrinter ? `<span>${t.printer}: ${b.printerId}</span>` : ""}
      </div>
      <div class="footer-meta">
        <span>${t.printedAt}: ${printedAtStr}</span>
        ${showTerminal ? `<span>${t.terminal}: ${b.terminalId}</span>` : ""}
      </div>
      ${showItemCount ? `<div class="item-count">${t.itemCount}: ${itemCount}</div>` : ""}
      <div class="dashed"></div>

      <div class="thanks">
        ${customFooter ? customFooter : (data.footer || `${t.thanks} ✨`)}
      </div>

      ${contactBlock}

      ${promoBlock}

      ${extraQrBlock}

      ${qrBlock}

      ${data.zatca ? `
      <div class="qr-ids">
        <div>${t.reference}: ${data.zatca.vatNumber}</div>
        ${data.zatca.crNumber ? `<div>${t.crNo}: ${data.zatca.crNumber}</div>` : ""}
      </div>` : ""}
    </body>
    </html>
  `;
}

// Generate kitchen order HTML
export function generateKitchenOrderHTML(data: KitchenOrderData): string {
  const itemsHTML = data.items
    .map(
      (item) => `
      <div class="item ${data.priority === 'rush' ? 'rush' : ''}">
        <div class="item-qty">${item.quantity}x</div>
        <div class="item-details">
          <div class="item-name">${item.name}${item.size ? ` (${item.size})` : ""}</div>
          ${item.notes ? `<div class="item-notes">${item.notes}</div>` : ""}
        </div>
      </div>
    `
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Kitchen Order - ${data.orderNumber}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Arial', sans-serif;
          width: 80mm;
          padding: 10px;
          font-size: 14px;
        }
        .header {
          text-align: center;
          border-bottom: 2px solid #000;
          padding-bottom: 10px;
          margin-bottom: 15px;
        }
        .order-number {
          font-size: 24px;
          font-weight: bold;
        }
        .time {
          font-size: 16px;
          margin-top: 5px;
        }
        .rush-banner {
          background: #000;
          color: #fff;
          text-align: center;
          padding: 5px;
          font-weight: bold;
          font-size: 18px;
          margin-bottom: 10px;
        }
        .table-info {
          text-align: center;
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 10px;
          padding: 5px;
          background: #eee;
        }
        .item {
          display: flex;
          padding: 8px 0;
          border-bottom: 1px dashed #ccc;
        }
        .item.rush {
          background: #fff3cd;
        }
        .item-qty {
          font-size: 20px;
          font-weight: bold;
          width: 40px;
        }
        .item-details { flex: 1; }
        .item-name {
          font-size: 16px;
          font-weight: bold;
        }
        .item-notes {
          font-size: 12px;
          color: #666;
          font-style: italic;
          margin-top: 3px;
        }
        @media print {
          body { width: 80mm; margin: 0; }
          @page { size: 80mm auto; margin: 0; }
        }
      </style>
    </head>
    <body>
      ${data.priority === "rush" ? '<div class="rush-banner">⚡ RUSH ORDER ⚡</div>' : ""}
      ${data.stationLabel ? `<div class="rush-banner" style="background:#111;color:#fff;letter-spacing:2px">${data.stationLabel}</div>` : ""}

      <div class="header">
        <div class="order-number">#${data.orderNumber}</div>
        <div class="time">${format(data.date, "HH:mm:ss")}</div>
      </div>
      
      ${data.tableNumber ? `<div class="table-info">Table: ${data.tableNumber}</div>` : ""}
      
      <div class="items">
        ${itemsHTML}
      </div>
    </body>
    </html>
  `;
}

// Helper to format price
function formatPrice(amount: number): string {
  // Receipts use a neutral Riyal symbol ('﷼' = U+FDFC) to match the
  // standard KSA simplified-tax-invoice format. The amount is rendered
  // LTR so the digits sit naturally inside the RTL receipt body.
  return `﷼${formatMoneyAmount(Number.isFinite(amount) ? amount : 0)}`;
}

// Print via browser without opening a popup window.
export async function printViaBrowser(html: string): Promise<void> {
  if (typeof document === "undefined") return;

  const { dataUrl, width, height } = await renderHtmlToImageDataUrl(html, {
    backgroundColor: "#ffffff",
    scale: 2,
    sandboxWidth: "80mm",
  });

  const printableHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <title>Receipt Print</title>
      <style>
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          background: #fff;
        }
        body {
          display: flex;
          justify-content: center;
          align-items: flex-start;
        }
        img {
          display: block;
          width: 80mm;
          max-width: 100%;
          height: auto;
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }
        @page { size: 80mm auto; margin: 0; }
        @media print {
          html, body { width: 80mm; }
          body { margin: 0; }
          img { width: 80mm; }
        }
      </style>
    </head>
    <body>
      <img src="${dataUrl}" alt="Printed receipt" width="${width}" height="${height}" />
    </body>
    </html>
  `;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 1000);
  };

  iframe.onload = () => {
    const frameWindow = iframe.contentWindow;
    const frameDocument = frameWindow?.document;
    if (!frameWindow || !frameDocument) {
      cleanup();
      return;
    }

    const waitForAssets = async () => {
      const fontSet = (frameDocument as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
      if (fontSet?.ready) {
        await fontSet.ready.catch(() => undefined);
      }

      await Promise.all(
        Array.from(frameDocument.images).map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) {
                resolve();
                return;
              }
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
        ),
      );

      frameWindow.addEventListener("afterprint", cleanup, { once: true });
      frameWindow.focus();
      frameWindow.print();
      window.setTimeout(cleanup, 60000);
    };

    void waitForAssets();
  };

  document.body.appendChild(iframe);
  const frameDocument = iframe.contentWindow?.document;
  if (!frameDocument) {
    iframe.remove();
    throw new Error("Unable to create browser print frame");
  }

  frameDocument.open();
  frameDocument.write(printableHtml);
  frameDocument.close();
}

// Print via network printer (ESC/POS compatible)
export async function printViaNetwork(
  content: string,
  printerIp: string,
  printerPort: number = 9100
): Promise<boolean> {
  // Note: Direct network printing from browser requires a backend proxy
  // For now, fall back to browser print with a notification
  console.log(`Network print requested to ${printerIp}:${printerPort}`);
  
  // In production, this would call an edge function that handles the raw socket connection
  // For browser-only, we fall back to browser print
  await printViaBrowser(content);
  return true;
}

// ESC/POS command to open cash drawer
export function getCashDrawerKickCommand(kickCode: string = "27,112,0,25,250"): Uint8Array {
  const codes = kickCode.split(",").map((c) => parseInt(c.trim(), 10));
  return new Uint8Array(codes);
}

// Try to open cash drawer via Web Serial API (if available)
export async function openCashDrawerViaSerial(): Promise<boolean> {
  if (!("serial" in navigator)) {
    console.warn("Web Serial API not supported in this browser");
    return false;
  }

  try {
    // @ts-ignore - Web Serial API types
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    
    const writer = port.writable.getWriter();
    const kickCommand = getCashDrawerKickCommand();
    await writer.write(kickCommand);
    writer.releaseLock();
    
    await port.close();
    return true;
  } catch (error) {
    console.error("Failed to open cash drawer via serial:", error);
    return false;
  }
}

// Print receipt with embedded drawer kick command
export async function printReceiptWithDrawerKick(
  receiptHTML: string,
  openDrawer: boolean = false,
  kickCode: string = "27,112,0,25,250"
): Promise<void> {
  // For ESC/POS printers, the drawer kick is typically sent as part of the print job
  // Browser print doesn't support this directly, but we can add a note
  
  if (openDrawer) {
    // Add drawer kick indicator in the HTML for thermal printers that support it
    const modifiedHTML = receiptHTML.replace(
      "</body>",
      `<!-- ESC/POS Drawer Kick: ${kickCode} --></body>`
    );
    await printViaBrowser(modifiedHTML);
  } else {
    await printViaBrowser(receiptHTML);
  }
}

// Combined print and drawer function for POS
export async function handlePOSPrint(
  receiptData: ReceiptData,
  kitchenData: KitchenOrderData | null,
  settings: {
    receiptEnabled: boolean;
    receiptPrinterType: "browser" | "network" | "bluetooth" | "usb" | "local-agent";
    receiptPrinterIp?: string;
    receiptPrinterPort?: number;
    kitchenEnabled: boolean;
    kitchenPrinterType: "browser" | "network" | "bluetooth" | "usb" | "local-agent";
    kitchenPrinterIp?: string;
    kitchenPrinterPort?: number;
    drawerEnabled: boolean;
    drawerAutoOpen: boolean;
    drawerKickCode?: string;
    template?: TemplatePreset;
    templateConfig?: TemplateConfig;
    paymentMethod: string;
    /** Optional bar ticket (drinks). Routed to a separate printer. */
    barData?: KitchenOrderData | null;
    barEnabled?: boolean;
    barPrinterType?: "browser" | "network" | "bluetooth" | "usb" | "local-agent";
    barPrinterIp?: string;
    barPrinterPort?: number;
  }
): Promise<void> {
  const promises: Promise<void>[] = [];

  // Print receipt
  if (settings.receiptEnabled) {
    if (settings.receiptPrinterType === "browser") {
      const receiptHTML = await generateReceiptHTML(receiptData);
      // Check if we should open drawer (only for cash payments)
      const shouldOpenDrawer = 
        settings.drawerEnabled && 
        settings.drawerAutoOpen && 
        settings.paymentMethod === "cash";
      
      promises.push(printReceiptWithDrawerKick(receiptHTML, shouldOpenDrawer));
    } else {
      const shouldOpenDrawer =
        settings.drawerEnabled &&
        settings.drawerAutoOpen &&
        settings.paymentMethod.toLowerCase() === "cash";
      promises.push(
        queueReceiptPrint(receiptData, {
          receiptPrinterType: settings.receiptPrinterType,
          receiptPrinterIp: settings.receiptPrinterIp,
          receiptPrinterPort: settings.receiptPrinterPort,
          openDrawer: shouldOpenDrawer,
          drawerKickCode: settings.drawerKickCode,
          template: settings.template,
          templateConfig: settings.templateConfig,
        }).then(() => {})
      );
    }
  }

  // Print kitchen order
  if (settings.kitchenEnabled && kitchenData) {
    const kitchenHTML = generateKitchenOrderHTML(kitchenData);
    
    if (settings.kitchenPrinterType === "browser") {
      // Slight delay to not overlap with receipt print
      setTimeout(() => {
        void printViaBrowser(kitchenHTML);
      }, 500);
    } else if (settings.kitchenPrinterType === "network" && settings.kitchenPrinterIp) {
      promises.push(
        printViaNetwork(kitchenHTML, settings.kitchenPrinterIp, settings.kitchenPrinterPort).then(() => {})
      );
    }
  }

  // Print bar order (drinks) — separate printer route
  if (settings.barEnabled && settings.barData && settings.barData.items.length > 0) {
    const barHTML = generateKitchenOrderHTML(settings.barData);
    const type = settings.barPrinterType ?? "browser";
    if (type === "browser") {
      setTimeout(() => {
        void printViaBrowser(barHTML);
      }, 1000);
    } else if (type === "network" && settings.barPrinterIp) {
      promises.push(
        printViaNetwork(barHTML, settings.barPrinterIp, settings.barPrinterPort).then(() => {})
      );
    }
  }

  // Open cash drawer separately if not using receipt printer
  if (
    settings.drawerEnabled &&
    settings.drawerAutoOpen &&
    settings.paymentMethod === "cash" &&
    !settings.receiptEnabled
  ) {
    // Try serial connection for standalone drawer
    await openCashDrawerViaSerial();
  }

  await Promise.all(promises);
}
