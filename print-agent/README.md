# Matbex Local Print Agent

A tiny HTTP service that runs on the POS machine and prints raw ESC/POS
to USB thermal printers (TA-900U / PA-900U and clones). The browser POS
never touches the printer — it just `POST`s receipt JSON to
`http://127.0.0.1:9911/print`.

Designed for:

- Pixel-perfect receipts (raster mode, not text mode).
- Correct Arabic shaping + RTL/bidi (via `arabic-persian-reshaper` +
  `bidi-js` + HarfBuzz-backed `node-canvas`).
- 58 mm and 80 mm rolls, bold / center / right alignment.
- Auto-start on boot (Windows service via NSSM).
- Zero browser print dialog.

---

## 1. Install

Requirements: Node.js 18 – 22 on the POS. No Visual Studio / GTK
build tools needed — `@napi-rs/canvas` ships prebuilt Windows
binaries, and `usb` uses `node-gyp-build` prebuilds.

> ⚠️ Node 24 is not yet supported by the `usb` prebuilds.
> Install Node 20 LTS or 22 LTS from https://nodejs.org.

```bash
cd print-agent
npm install
npm start          # dev mode: http://127.0.0.1:9911
```

Optional: drop `NotoSansArabic-Regular.ttf` / `-Bold.ttf` into
`src/assets/fonts/` for the cleanest Arabic glyphs. Without them the
agent falls back to Tahoma (ships with Windows and shapes Arabic
correctly).

---

## 2. Build a single Windows .exe

```bash
npm run build:win
# → dist/matbex-print-agent.exe
```

---

## 3. Auto-start on boot (Windows)

1. Download [NSSM](https://nssm.cc/download), put `nssm.exe` in PATH.
2. Run `install-windows-service.bat` **as Administrator**.
3. The agent now starts at boot and is reachable at
   `http://127.0.0.1:9911`.

Logs land in `print-agent/logs/agent.out.log`.

---

## 4. HTTP API

### `GET /health`

```json
{ "ok": true, "agent": "matbex-print-agent", "version": "1.0.0" }
```

### `GET /printers`

Lists detected USB devices (vendor:product hex IDs).

### `POST /print`

```jsonc
{
  "widthMm": 80,                 // 58 or 80
  "printer": null,               // null = auto-USB, "POS-80" = OS name,
                                 // "04b8:0e15" = vid:pid for libusb
  "openDrawer": true,
  "drawerKickCode": "27,112,0,25,250",
  "copies": 1,
  "receipt": {
    "restaurantName": "Matbex Cafe",
    "restaurantNameAr": "مقهى مطبخ",
    "header": "Welcome / أهلاً وسهلاً",
    "address": "King Fahd Rd, Riyadh",
    "addressAr": "طريق الملك فهد، الرياض",
    "phone": "+966 50 000 0000",
    "vatNumber": "300000000000003",
    "receiptNumber": "A-1042",
    "date": "2026-06-06 14:32",
    "cashierName": "Ahmed",
    "customerName": "Walk-in",
    "orderType": "Dine-in / صالة",
    "currency": "SAR",
    "items": [
      { "name": "Chicken Shawarma", "nameAr": "شاورما دجاج",
        "quantity": 2, "unitPrice": 18, "total": 36, "size": "Large" },
      { "name": "Pepsi 330ml", "nameAr": "بيبسي",
        "quantity": 2, "unitPrice": 5, "total": 10 }
    ],
    "subtotal": 46.00,
    "discount": 0,
    "tax": 6.90,
    "total": 52.90,
    "paymentMethod": "Cash / نقدًا",
    "footer": "Thank you for visiting!",
    "footerAr": "شكراً لزيارتكم"
  }
}
```

Response: `{ "ok": true, "bytes": 18432, "copies": 1, "widthMm": 80 }`.

---

## 5. From the React POS

```ts
await fetch("http://127.0.0.1:9911/print", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ widthMm: 80, openDrawer: paid === "cash", receipt }),
});
```

That's it — no `window.print()`, no driver dialog, no font issues.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `No USB thermal printer detected` | On Windows, use Zadig once to bind the printer's USB interface to **WinUSB**, OR pass the OS printer name in `printer`. |
| Arabic prints as `?????` | You're hitting a text-mode path. This agent always rasterizes — make sure the POS is calling this agent, not the old browser print. |
| Drawer doesn't open | Confirm the kick code with the printer manual; common values: `27,112,0,25,250` or `27,112,0,50,250`. |
| Cut is missing | Some clones use full cut `GS V 0`; edit `wrapReceipt` in `src/escpos.js`. |

---

## 7. Security

The agent binds to `127.0.0.1` only by default. Do **not** expose it on
`0.0.0.0` without putting it behind a reverse proxy + auth — anyone on
the LAN could print to your terminal.