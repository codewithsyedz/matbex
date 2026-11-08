#!/usr/bin/env node
/**
 * Matbex Local Print Agent
 * ------------------------------------------------------------------
 * Tiny HTTP service that runs on the POS machine (Windows / Linux /
 * macOS) and exposes a single `POST /print` endpoint. The browser POS
 * never talks to the printer directly — it just POSTs receipt JSON.
 *
 * Pipeline:
 *   JSON → renderReceiptToCanvas() → ESC/POS raster bytes → USB
 *
 * Why raster mode?
 *   Cheap TA-900U / PA-900U clones have no Arabic codepage. Rendering
 *   the receipt as a bitmap with HarfBuzz/Pango-backed node-canvas
 *   gives pixel-perfect Arabic shaping + RTL + mixed bidi text.
 */

const express = require("express");
const cors = require("cors");
const { renderReceiptToCanvas } = require("./render");
const { canvasToEscposRaster, wrapReceipt } = require("./escpos");
const { printRawBytes, listPrinters } = require("./printer");

const PORT = Number(process.env.PRINT_AGENT_PORT || 9911);
const HOST = process.env.PRINT_AGENT_HOST || "127.0.0.1";
const VERSION = require("../package.json").version;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, agent: "matbex-print-agent", version: VERSION });
});

app.get("/printers", async (_req, res) => {
  try {
    const printers = await listPrinters();
    res.json({ printers });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * POST /print
 * Body: {
 *   widthMm: 58 | 80,                 // default 80
 *   printer?: string,                 // OS printer name, USB vid:pid, or null
 *   openDrawer?: boolean,
 *   drawerKickCode?: string,          // "27,112,0,25,250"
 *   copies?: number,                  // default 1
 *   receipt: ReceiptPayload           // see render.js
 * }
 */
app.post("/print", async (req, res) => {
  const body = req.body || {};
  const widthMm = body.widthMm === 58 ? 58 : 80;
  const copies = Math.max(1, Math.min(5, Number(body.copies) || 1));

  try {
    if (!body.receipt) throw new Error("Missing 'receipt' field.");

    const canvas = await renderReceiptToCanvas(body.receipt, { widthMm });
    const escpos = wrapReceipt(canvasToEscposRaster(canvas), {
      openDrawer: !!body.openDrawer,
      drawerKickCode: body.drawerKickCode,
    });

    for (let i = 0; i < copies; i++) {
      await printRawBytes(escpos, { printer: body.printer || null });
    }

    res.json({ ok: true, bytes: escpos.length, copies, widthMm });
  } catch (err) {
    console.error("[print] failed:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

/**
 * POST /raw
 * Body: { printer?: string, bytesBase64?: string }
 * OR Content-Type: application/octet-stream with raw body bytes.
 * Used for cash-drawer kick codes and any other ESC/POS escape sequence
 * the browser wants to send through the printer.
 */
app.post(
  "/raw",
  express.raw({ type: "application/octet-stream", limit: "1mb" }),
  async (req, res) => {
    try {
      let bytes;
      let printer = req.query.printer || null;
      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        bytes = req.body;
      } else if (req.body && typeof req.body === "object" && req.body.bytesBase64) {
        bytes = Buffer.from(req.body.bytesBase64, "base64");
        printer = req.body.printer || printer;
      } else {
        throw new Error("No bytes supplied. Send octet-stream body or { bytesBase64 }.");
      }
      await printRawBytes(bytes, { printer: printer || null });
      res.json({ ok: true, bytes: bytes.length });
    } catch (err) {
      console.error("[raw] failed:", err);
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  },
);

/**
 * POST /kick
 * Body: { printer?: string, kickCode?: string }
 * Dedicated cash-drawer kick. Wraps the pulse with ESC @ (init) + both
 * pin 2 AND pin 5 pulses + ESC d (feed) + GS V (partial cut) so the
 * Windows spooler actually flushes the job to the printer firmware and
 * the drawer pin fires regardless of which pin the RJ11 drawer is wired
 * to. This is the reliable path; /raw alone is not enough on most clones.
 */
app.post("/kick", express.json(), async (req, res) => {
  try {
    const printer = (req.body && req.body.printer) || req.query.printer || null;
    const userKick = req.body && req.body.kickCode;

    const init = Buffer.from([0x1b, 0x40]);                       // ESC @
    // Always send BOTH pin pulses with a long enough duty cycle so the
    // solenoid actually throws — many cheap drawers need t1≥50 (~100 ms).
    const pin2 = Buffer.from([0x1b, 0x70, 0x00, 0x32, 0xfa]);     // ESC p 0 50 250
    const pin5 = Buffer.from([0x1b, 0x70, 0x01, 0x32, 0xfa]);     // ESC p 1 50 250
    // Honour the user-configured code too (in case their drawer is a
    // non-standard clone with a custom pulse sequence).
    let custom = Buffer.alloc(0);
    if (userKick && typeof userKick === "string") {
      try {
        custom = Buffer.from(
          userKick.split(",").map((c) => parseInt(c.trim(), 10) & 0xff),
        );
      } catch { /* ignore parse errors */ }
    }
    const feed = Buffer.from([0x1b, 0x64, 0x01]);                 // feed 1 line
    const cut = Buffer.from([0x1d, 0x56, 0x01]);                  // partial cut

    const payload = Buffer.concat([init, custom, pin2, pin5, feed, cut]);
    await printRawBytes(payload, { printer: printer || null });
    res.json({ ok: true, bytes: payload.length });
  } catch (err) {
    console.error("[kick] failed:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Matbex Print Agent v${VERSION} listening on http://${HOST}:${PORT}`);
  console.log(`  Health: http://${HOST}:${PORT}/health`);
  console.log(`  Print:  POST http://${HOST}:${PORT}/print`);
});