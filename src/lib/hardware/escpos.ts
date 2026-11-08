// =====================================================================
// ESC/POS receipt builder — image / raster mode
// ---------------------------------------------------------------------
// Renders the receipt to an HTML5 canvas (so the browser can fully
// shape Arabic, mixed RTL/LTR, currency glyphs, etc.) then ships it
// to the printer as an ESC/POS raster bit-image (`GS v 0`). This is
// the only reliable way to get Arabic to print on cheap TA-900U /
// Xprinter clones whose firmware does NOT include an Arabic
// codepage — text mode would just emit `?????`.
//
// Output is a Uint8Array suitable for any raw-bytes transport: QZ
// Tray, network 9100, WebUSB, Bluetooth SPP, native USB.
// =====================================================================

import type { PrintReceiptPayload } from "./types";
import { renderHtmlToCanvas } from "@/lib/printRaster";

const ESC = 0x1b;
const GS = 0x1d;

export function parseKickCode(code: string): Uint8Array {
  return new Uint8Array(
    code
      .split(",")
      .map((c) => parseInt(c.trim(), 10))
      .filter((n) => Number.isFinite(n)),
  );
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------
// Canvas → monochrome bitmap → ESC/POS raster
// ---------------------------------------------------------------------

const RECEIPT_WIDTH_PX = 576;       // 80 mm @ 8 dots/mm (standard for TA-900U)

async function renderLinesToBitmap(
  payload: PrintReceiptPayload,
): Promise<{ bytes: Uint8Array; widthBytes: number; height: number }> {
  if (typeof document === "undefined") {
    throw new Error("Receipt image rendering requires a browser context (no DOM available).");
  }

  const { generateReceiptHTML, receiptPayloadToData } = await import("@/lib/printUtils");
  const receiptData = receiptPayloadToData(payload);
  const html = await generateReceiptHTML(receiptData);
  const canvas = await renderHtmlToCanvas(html, {
    backgroundColor: "#ffffff",
    scale: 2,
    sandboxWidth: "80mm",
  });

  const targetHeight = Math.max(1, Math.round((canvas.height * RECEIPT_WIDTH_PX) / canvas.width));
  const scaled = document.createElement("canvas");
  scaled.width = RECEIPT_WIDTH_PX;
  scaled.height = targetHeight;
  const ctx = scaled.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context for receipt rendering.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, scaled.width, scaled.height);
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);

  const img = ctx.getImageData(0, 0, scaled.width, scaled.height).data;
  const widthBytes = Math.ceil(RECEIPT_WIDTH_PX / 8);
  const out = new Uint8Array(widthBytes * scaled.height);
  for (let yy = 0; yy < scaled.height; yy++) {
    for (let xx = 0; xx < RECEIPT_WIDTH_PX; xx++) {
      const idx = (yy * RECEIPT_WIDTH_PX + xx) * 4;
      const lum = (img[idx] + img[idx + 1] + img[idx + 2]) / 3;
      // alpha-aware: treat fully transparent pixels as white
      if (img[idx + 3] > 32 && lum < 160) {
        out[yy * widthBytes + (xx >> 3)] |= 0x80 >> (xx & 7);
      }
    }
  }
  return { bytes: out, widthBytes, height: scaled.height };
}

function rasterCommand(bmp: {
  bytes: Uint8Array;
  widthBytes: number;
  height: number;
}): Uint8Array {
  // Split into 128-row bands — many cheap printers choke on a single
  // monolithic raster, so we chunk it. GS v 0 m xL xH yL yH …
  const parts: Uint8Array[] = [];
  const BAND = 128;
  const xL = bmp.widthBytes & 0xff;
  const xH = (bmp.widthBytes >> 8) & 0xff;
  for (let off = 0; off < bmp.height; off += BAND) {
    const rows = Math.min(BAND, bmp.height - off);
    const header = new Uint8Array([
      GS, 0x76, 0x30, 0x00,
      xL, xH,
      rows & 0xff, (rows >> 8) & 0xff,
    ]);
    parts.push(header);
    parts.push(
      bmp.bytes.subarray(off * bmp.widthBytes, (off + rows) * bmp.widthBytes),
    );
  }
  return concat(parts);
}

export async function buildReceiptBytes(p: PrintReceiptPayload): Promise<Uint8Array> {
  const init = new Uint8Array([ESC, 0x40]);
  const alignCenter = new Uint8Array([ESC, 0x61, 0x01]);
  const feed = new Uint8Array([ESC, 0x64, 0x03]);
  const cut = new Uint8Array([GS, 0x56, 0x01]);
  const drawer =
    p.openDrawer && p.drawerKickCode ? parseKickCode(p.drawerKickCode) : new Uint8Array(0);

  const bmp = await renderLinesToBitmap(p);
  const raster = rasterCommand(bmp);

  return concat([init, alignCenter, raster, feed, drawer, cut]);
}