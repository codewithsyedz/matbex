/**
 * ESC/POS raster builder
 * ------------------------------------------------------------------
 * Converts a node-canvas bitmap into a sequence of `GS v 0` raster
 * commands. Splits the image into 128-row bands so cheap firmware
 * (TA-900U / PA-900U) doesn't choke on a single monolithic raster.
 */

const ESC = 0x1b;
const GS  = 0x1d;

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = Buffer.allocUnsafe(len);
  let o = 0;
  for (const p of parts) { p.copy(out, o); o += p.length; }
  return out;
}

function parseKickCode(code) {
  return Buffer.from(
    String(code || "27,112,0,25,250")
      .split(",")
      .map((c) => parseInt(c.trim(), 10) & 0xff),
  );
}

/** Canvas (any width) → 1-bit packed bitmap + ESC/POS GS v 0 bands. */
function canvasToEscposRaster(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const widthBytes = Math.ceil(width / 8);
  const img = ctx.getImageData(0, 0, width, height).data;
  const bmp = Buffer.alloc(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (img[i] + img[i + 1] + img[i + 2]) / 3;
      if (img[i + 3] > 32 && lum < 160) {
        bmp[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  const BAND = 128;
  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const parts = [];
  for (let off = 0; off < height; off += BAND) {
    const rows = Math.min(BAND, height - off);
    parts.push(Buffer.from([GS, 0x76, 0x30, 0x00, xL, xH, rows & 0xff, (rows >> 8) & 0xff]));
    parts.push(bmp.subarray(off * widthBytes, (off + rows) * widthBytes));
  }
  return concat(parts);
}

/** Wrap raster payload with printer init + feed + cut + optional drawer. */
function wrapReceipt(rasterBytes, opts = {}) {
  const init = Buffer.from([ESC, 0x40]);              // ESC @
  const center = Buffer.from([ESC, 0x61, 0x01]);      // ESC a 1
  const feed = Buffer.from([ESC, 0x64, 0x04]);        // feed 4 lines
  const cut = Buffer.from([GS, 0x56, 0x01]);          // partial cut
  let drawer = Buffer.alloc(0);
  if (opts.openDrawer) {
    // Fire BOTH drawer pins (2 and 5) with a strong duty cycle so the
    // solenoid always throws regardless of which pin the RJ11 cable
    // is wired to. Honour the user-configured code too in case their
    // drawer is a non-standard clone.
    const pin2 = Buffer.from([ESC, 0x70, 0x00, 0x32, 0xfa]); // ESC p 0 50 250
    const pin5 = Buffer.from([ESC, 0x70, 0x01, 0x32, 0xfa]); // ESC p 1 50 250
    const custom = opts.drawerKickCode ? parseKickCode(opts.drawerKickCode) : Buffer.alloc(0);
    drawer = Buffer.concat([custom, pin2, pin5]);
  }
  return concat([init, center, rasterBytes, feed, drawer, cut]);
}

module.exports = { canvasToEscposRaster, wrapReceipt, parseKickCode };