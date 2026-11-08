/**
 * Receipt → Canvas renderer
 * ------------------------------------------------------------------
 * Renders the receipt payload to a node-canvas bitmap with native
 * Arabic shaping and bidirectional text handling.
 *
 * - 80mm rolls print at 576px wide (8 dots/mm * 72mm printable)
 * - 58mm rolls print at 384px wide
 * - Arabic is drawn as raw Unicode text and shaped by the canvas
 *   text engine itself. Manual reshaping/reversal breaks joined
 *   glyphs on thermal receipts, so we only choose font + direction.
 */

const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
let QRCode = null;
try { QRCode = require("qrcode"); } catch { /* optional - QR will be skipped */ }
const registerFont = (file, opts) => {
  try { GlobalFonts.registerFromPath(file, opts.family); } catch { /* ignore */ }
};
const path = require("path");
const fs = require("fs");

// --- Fonts -----------------------------------------------------------
// Bundle Noto / Amiri fallback if present, otherwise rely on system
// fonts (Tahoma / Arial ship with Windows and shape Arabic fine).
const FONT_DIR = path.join(__dirname, "assets", "fonts");
function tryRegister(file, family) {
  const p = path.join(FONT_DIR, file);
  if (fs.existsSync(p)) {
    try { registerFont(p, { family }); } catch { /* ignore */ }
  }
}
tryRegister("NotoSansArabic-Regular.ttf", "Receipt AR");
tryRegister("NotoSansArabic-Bold.ttf",    "Receipt AR Bold");
tryRegister("NotoSans-Regular.ttf",       "Receipt LT");
tryRegister("NotoSans-Bold.ttf",          "Receipt LT Bold");

const AR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function shape(text) {
  if (text == null) return "";
  return String(text);
}

function fontStack(bold = false, ar = false) {
  const a = ar ? (bold ? "Receipt AR Bold" : "Receipt AR")
               : (bold ? "Receipt LT Bold" : "Receipt LT");
  // System fallbacks: Tahoma (Windows), Arial, sans-serif
  return `"${a}", "Tahoma", "Arial", sans-serif`;
}

function isArabicLine(s) { return AR_RE.test(String(s || "")); }

/**
 * Layout primitives. We measure-first and draw into a tall canvas
 * that is later cropped to actual height.
 */
class ReceiptLayout {
  constructor(width, scale) {
    this.width = width;
    this.scale = scale;
    this.padX = Math.round(8 * scale);
    this.y = Math.round(12 * scale);
    const tall = Math.round(4800 * scale); // upper bound; cropped later
    this.canvas = createCanvas(width, tall);
    this.ctx = this.canvas.getContext("2d");
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, width, tall);
    this.ctx.fillStyle = "#000000";
    this.ctx.textBaseline = "top";
  }
  _font(size, bold, ar) {
    return `${bold ? "700" : "400"} ${Math.round(size * this.scale)}px ${fontStack(bold, ar)}`;
  }
  _drawText(text, x, y, { align = "left", ar = false } = {}) {
    const ctx = this.ctx;
    const prevAlign = ctx.textAlign;
    const prevDirection = ctx.direction;
    ctx.textAlign = align;
    ctx.direction = ar ? "rtl" : "ltr";
    ctx.fillText(text, x, y);
    ctx.textAlign = prevAlign;
    ctx.direction = prevDirection;
  }
  line(text, opts = {}) {
    const {
      size = 13, bold = false, align = "left", gapAfter = 2,
    } = opts;
    const txt = shape(text);
    const ar = isArabicLine(text);
    this.ctx.font = this._font(size, bold, ar);
    const usableW = this.width - this.padX * 2;
    const lines = this._wrap(txt, usableW);
    const lineH = Math.round(size * 1.25 * this.scale);
    for (const ln of lines) {
      const resolvedAlign = align === "center" ? "center" : (align === "right" || ar ? "right" : "left");
      const x = resolvedAlign === "center"
        ? Math.round(this.width / 2)
        : resolvedAlign === "right"
          ? this.width - this.padX
          : this.padX;
      this._drawText(ln, x, this.y, { align: resolvedAlign, ar });
      this.y += lineH;
    }
    this.y += Math.round(gapAfter * this.scale);
  }
  row(left, right, opts = {}) {
    const { size = 13, bold = false, gapAfter = 2 } = opts;
    const l = shape(left), r = shape(right);
    const lAr = isArabicLine(left), rAr = isArabicLine(right);
    this.ctx.font = this._font(size, bold, lAr || rAr);
    const lineH = Math.round(size * 1.35 * this.scale);
    this._drawText(l, this.padX, this.y, { align: "left", ar: lAr });
    this._drawText(r, this.width - this.padX, this.y, { align: "right", ar: rAr });
    this.y += lineH + Math.round(gapAfter * this.scale);
  }
  rule(char = "-") {
    this.ctx.font = this._font(12, false, false);
    const m = this.ctx.measureText(char);
    const n = Math.max(1, Math.floor((this.width - this.padX * 2) / Math.max(1, m.width)));
    this.line(char.repeat(n), { size: 12, gapAfter: 4 });
  }
  feed(n = 1) {
    this.y += Math.round(8 * n * this.scale);
  }
  async qr(text, sizePx = 240) {
    if (!QRCode || !text) return;
    try {
      const buf = await QRCode.toBuffer(String(text), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: sizePx,
        color: { dark: "#000000", light: "#ffffff" },
      });
      const img = await loadImage(buf);
      const x = Math.round((this.width - sizePx) / 2);
      this.ctx.drawImage(img, x, this.y, sizePx, sizePx);
      this.y += sizePx + Math.round(6 * this.scale);
    } catch (e) {
      console.warn("[render] QR encode failed:", e.message);
    }
  }
  _wrap(text, maxWidth) {
    const words = text.split(/(\s+)/);
    const out = [];
    let cur = "";
    for (const w of words) {
      const tryLine = cur + w;
      if (this.ctx.measureText(tryLine).width <= maxWidth) cur = tryLine;
      else { if (cur) out.push(cur.trimEnd()); cur = w.trimStart(); }
    }
    if (cur) out.push(cur.trimEnd());
    return out.length ? out : [""];
  }
  crop() {
    const h = Math.min(this.canvas.height, this.y + Math.round(16 * this.scale));
    const out = createCanvas(this.width, h);
    out.getContext("2d").drawImage(this.canvas, 0, 0);
    return out;
  }
}

function money(n, currency = "SAR") {
  const v = Number(n || 0).toFixed(2);
  return `${v} ${currency}`;
}

/**
 * @param {object} r ReceiptPayload (see README)
 * @param {{ widthMm: 58|80 }} opts
 */
async function renderReceiptToCanvas(r, opts = {}) {
  // Per-template paper width overrides the global opts.
  const cfg = r.templateConfig || {};
  const widthMm =
    cfg.paperWidth === 58 || opts.widthMm === 58 ? 58 : 80;
  const widthPx = widthMm === 58 ? 384 : 576;
  const scale = 1; // already at printer DPI
  const L = new ReceiptLayout(widthPx, scale);
  const cur = r.currency || "SAR";
  const validTemplates = ["simple", "tax_invoice", "detailed", "saudi_bilingual", "zatca_standard"];
  const template = validTemplates.includes(r.template) ? r.template : "tax_invoice";
  const isSimple = template === "simple";
  const isDetailed = template === "detailed";
  const isBilingual = template === "saudi_bilingual" || cfg.language === "bilingual";
  const isStandard = template === "zatca_standard";
  const opt = cfg.options || {};
  const showOpt = (key, fallback) => (opt[key] === undefined ? fallback : !!opt[key]);

  // === Saudi Bilingual / ZATCA Standard branch (matches user-provided receipt) ===
  if (template === "saudi_bilingual" || isStandard) {
    return await renderBilingualReceipt(L, r, {
      cur, widthMm, isStandard, opt: showOpt, cfg,
    });
  }

  if (r.restaurantName) L.line(r.restaurantName, { size: 30, bold: true, align: "center" });
  if (r.restaurantNameAr) L.line(r.restaurantNameAr, { size: 26, bold: true, align: "center" });
  if (r.header) L.line(r.header, { size: 18, align: "center" });
  if (r.address) L.line(r.address, { size: 16, align: "center" });
  if (r.addressAr) L.line(r.addressAr, { size: 16, align: "center" });
  if (r.phone) L.line(r.phone, { size: 16, align: "center" });
  if (!isSimple && r.vatNumber) L.line(`VAT / الرقم الضريبي: ${r.vatNumber}`, { size: 16, align: "center" });

  L.rule("=");

  if (r.receiptNumber) L.row("Receipt #", String(r.receiptNumber), { bold: true, size: 18 });
  if (r.date) L.row("Date", String(r.date), { size: 18 });
  if (!isSimple && r.cashierName) L.row("Cashier", String(r.cashierName), { size: 18 });
  if (!isSimple && r.customerName) L.row("Customer", String(r.customerName), { size: 18 });
  if (!isSimple && r.orderType) L.row("Type", String(r.orderType), { size: 18 });

  L.rule("-");
  L.row("Item", "Total", { bold: true, size: 18 });
  L.rule("-");

  for (const it of r.items || []) {
    const name = it.nameAr ? `${it.name}  |  ${it.nameAr}` : it.name;
    L.row(name, money(it.total, cur), { bold: false, size: 18 });
    if (!isSimple) {
      const qtyLine = `  ${it.quantity} × ${money(it.unitPrice, cur)}` +
                      (it.size ? `  (${it.size})` : "");
      L.line(qtyLine, { size: 15 });
      if (isDetailed && it.notes) {
        L.line(`  · ${it.notes}`, { size: 14 });
      }
    } else {
      L.line(`  × ${it.quantity}`, { size: 15 });
    }
  }

  L.rule("-");
  if (!isSimple && r.subtotal != null) L.row("Subtotal", money(r.subtotal, cur), { size: 18 });
  if (!isSimple && r.discount)        L.row("Discount", `- ${money(r.discount, cur)}`, { size: 18 });
  if (!isSimple && r.tax != null)     L.row("VAT 15%", money(r.tax, cur), { size: 18 });
  L.row("TOTAL", money(r.total, cur), { bold: true, size: 26 });

  if (r.paymentMethod) {
    L.feed(1);
    L.row("Paid by", String(r.paymentMethod), { size: 18, bold: true });
  }

  // QR code — prefer ZATCA TLV, then explicit qr, then receipt number.
  // Simple template never prints a QR.
  const qrValue = isSimple
    ? null
    : (r.zatca && r.zatca.qrBase64) || r.qr || r.qrCode || r.receiptNumber;
  if (qrValue) {
    L.feed(1);
    await L.qr(qrValue, widthMm === 58 ? 140 : 196);
    if (r.receiptNumber) {
      L.line(`Scan to verify · #${r.receiptNumber}`, { size: 14, align: "center" });
    }
  }

  if (r.footer)   { L.feed(1); L.line(r.footer,   { size: 16, align: "center" }); }
  if (r.footerAr) {              L.line(r.footerAr, { size: 16, align: "center" }); }

  L.feed(2);
  return L.crop();
}

/**
 * Bilingual EN/AR ZATCA Simplified or Standard receipt — matches the
 * "Jamaan Al-Dosari" reference receipt: every row has the English label
 * with the Arabic label underneath, centered Simplified/Standard banner,
 * item name with Arabic translation below, totals block, QR, thanks.
 */
async function renderBilingualReceipt(L, r, { cur, widthMm, isStandard, opt, cfg }) {
  const showLogo = opt("showLogo", true);
  const showQR = opt("showQR", true);
  const showVat = opt("showVat", true);
  const showCashier = opt("showCashier", false);
  const showCustomer = opt("showCustomer", true);
  const showBuyer = opt("showBuyerBlock", isStandard);

  const pairLine = (en, ar, optsLine = {}) => {
    if (en) L.line(en, { size: 18, align: "center", gapAfter: 0, ...optsLine });
    if (ar) L.line(ar, { size: 16, align: "center", gapAfter: 2, ...optsLine });
  };

  // --- Header
  if (showLogo && r.logoUrl) {
    // Logo support is optional — agent loads via loadImage if you add it later.
  }
  if (r.restaurantName) L.line(r.restaurantName, { size: 26, bold: true, align: "center" });
  if (r.restaurantNameAr) L.line(r.restaurantNameAr, { size: 28, bold: true, align: "center" });
  if (r.vatNumber) L.line(`VAT No. ${r.vatNumber}`, { size: 16, align: "center" });
  if (r.phone) L.line(`PH No. ${r.phone}`, { size: 16, align: "center" });
  if (r.address) L.line(r.address, { size: 16, align: "center" });
  if (r.addressAr) L.line(r.addressAr, { size: 20, align: "center" });
  if (cfg.headerNoteEn) L.line(cfg.headerNoteEn, { size: 15, align: "center" });
  if (cfg.headerNoteAr) L.line(cfg.headerNoteAr, { size: 20, align: "center" });

  L.rule("-");

  // --- Meta rows (bilingual labels)
  if (r.receiptNumber) {
    L.row("Invoice", `#${r.receiptNumber}`, { size: 17, bold: true });
    L.line("فاتورة", { size: 20, align: "right" });
  }
  if (r.date) {
    L.row("Date & time", String(r.date), { size: 16 });
    L.line("التاريخ والوقت", { size: 19, align: "right" });
  }
  if (showCashier && r.cashierName) {
    L.row("Cashier", String(r.cashierName), { size: 16 });
    L.line("الكاشير", { size: 19, align: "right" });
  }
  if (showCustomer) {
    L.row("Customer", String(r.customerName || "NA"), { size: 16 });
    L.line("العميل", { size: 19, align: "right" });
  }

  // --- Standard B2B buyer block
  if (isStandard && showBuyer && cfg.buyer) {
    L.rule("-");
    L.line("Buyer / المشتري", { size: 16, bold: true, align: "center" });
    if (cfg.buyer.name) L.line(cfg.buyer.name, { size: 16 });
    if (cfg.buyer.vatNumber) L.line(`VAT: ${cfg.buyer.vatNumber}`, { size: 16 });
    if (cfg.buyer.address) L.line(cfg.buyer.address, { size: 15 });
    if (cfg.buyer.idValue) L.line(`ID: ${cfg.buyer.idValue}`, { size: 15 });
  }

  L.rule("-");

  // --- Invoice type banner
  const bannerEn = isStandard ? "Standard Tax Invoice" : "Simplified Tax Invoice";
  const bannerAr = isStandard ? "فاتورة ضريبية" : "فاتورة ضريبية مبسطة";
  L.line(bannerEn, { size: 18, bold: true, align: "center" });
  L.line(bannerAr, { size: 22, bold: true, align: "center" });

  L.rule("-");

  // --- Items header
  L.line("Description", { size: 15, gapAfter: 0 });
  L.line("الوصف", { size: 19, gapAfter: 2 });
  L.row("Unit Price", "Qty", { size: 14 });
  L.line("سعر الوحدة                 الكمية", { size: 18, align: "right" });

  L.rule("-");

  // --- Items
  for (const it of r.items || []) {
    if (it.name) L.line(it.name, { size: 16, gapAfter: 0 });
    if (it.nameAr) L.line(it.nameAr, { size: 19, gapAfter: 0 });
    L.row(
      `${money(it.unitPrice, cur)}    ${it.quantity}`,
      money(it.total, cur),
      { size: 16 },
    );
    if (it.notes) L.line(`  · ${it.notes}`, { size: 13 });
  }

  L.rule("-");

  // --- Totals (bilingual)
  if (showVat && r.subtotal != null) {
    L.row("Total Taxable Amount", money(r.subtotal, cur), { size: 16 });
    L.line("الإجمالي الخاضع للضريبة", { size: 19, align: "right" });
  }
  if (showVat && r.discount) {
    L.row("Discount", `- ${money(r.discount, cur)}`, { size: 16 });
    L.line("الخصم", { size: 19, align: "right" });
  }
  if (showVat && r.tax != null) {
    L.row("Total VAT", money(r.tax, cur), { size: 16 });
    L.line("إجمالي ضريبة القيمة المضافة", { size: 19, align: "right" });
  }
  L.row("Total Amount", money(r.total, cur), { bold: true, size: 22 });
  L.line("الإجمالي", { size: 20, align: "right" });

  if (r.paymentMethod) {
    L.feed(1);
    L.row(r.paymentMethod, money(r.total, cur), { size: 16, bold: true });
  }

  // --- QR
  if (showQR) {
    const qrValue = (r.zatca && r.zatca.qrBase64) || r.qr || r.receiptNumber;
    if (qrValue) {
      L.feed(1);
      await L.qr(qrValue, widthMm === 58 ? 140 : 182);
    }
  }

  // --- Thanks / custom footer
  L.feed(1);
  const thanksEn = cfg.footerNoteEn || r.footer || "Thank You";
  const thanksAr = cfg.footerNoteAr || r.footerAr || "شكراً لزيارتكم";
  L.line(thanksEn, { size: 16, align: "center" });
  L.line(thanksAr, { size: 20, align: "center" });

  L.feed(2);
  return L.crop();
}

module.exports = { renderReceiptToCanvas, shape };