/**
 * Raw-bytes transport
 * ------------------------------------------------------------------
 * Two paths, picked automatically:
 *
 *   1) USB direct (libusb) — when `printer` looks like "vid:pid" or
 *      when a single ESC/POS class USB device is detected. Works on
 *      Windows once Zadig has bound the printer to WinUSB.
 *
 *   2) OS spooler raw — when `printer` is an installed printer name.
 *      On Windows we call winspool.drv via PowerShell. On Linux/macOS
 *      we shell out to lp/lpr in raw mode. No native Node print driver
 *      dependency, no node-gyp, no Visual Studio required.
 */

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let usb = null;
try { usb = require("usb"); } catch { /* optional */ }

const VID_PID_RE = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

function findUsbDevice(printerHint) {
  if (!usb) return null;
  const devices = usb.getDeviceList();
  if (printerHint && VID_PID_RE.test(printerHint)) {
    const [, v, p] = printerHint.match(VID_PID_RE);
    return devices.find(
      (d) => d.deviceDescriptor.idVendor === parseInt(v, 16) &&
             d.deviceDescriptor.idProduct === parseInt(p, 16),
    ) || null;
  }
  // Heuristic: USB printer class (0x07) interface
  return devices.find((d) => {
    try {
      const cfg = d.configDescriptor;
      return cfg && cfg.interfaces.some((iset) =>
        iset.some((i) => i.bInterfaceClass === 0x07));
    } catch { return false; }
  }) || null;
}

async function printViaUsb(bytes, device) {
  return new Promise((resolve, reject) => {
    try {
      device.open();
      const iface = device.interfaces.find((i) =>
        i.descriptor.bInterfaceClass === 0x07) || device.interfaces[0];
      if (process.platform !== "win32") {
        try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch { /* */ }
      }
      iface.claim();
      const outEp = iface.endpoints.find((e) => e.direction === "out");
      if (!outEp) throw new Error("No OUT endpoint on USB printer.");
      outEp.transfer(bytes, (err) => {
        try { iface.release(true, () => device.close()); } catch { /* */ }
        if (err) reject(err); else resolve();
      });
    } catch (err) { reject(err); }
  });
}

/**
 * Send raw bytes to a named Windows printer via the Win32 spooler
 * (winspool.drv) using a tiny inline PowerShell script. No native module,
 * no node-gyp, no Visual Studio, no Python required.
 */
async function printViaSpooler(bytes, printerName) {
  if (process.platform !== "win32") {
    const tmpFile = path.join(os.tmpdir(), `matbex-print-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    fs.writeFileSync(tmpFile, bytes);
    try {
      const attempts = [
        ["lp", ["-d", printerName, "-o", "raw", tmpFile]],
        ["lpr", ["-P", printerName, "-l", tmpFile]],
      ];

      let lastError = null;
      for (const [cmd, args] of attempts) {
        const result = spawnSync(cmd, args, {
          encoding: "utf8",
          timeout: 15000,
        });
        if (result.error) {
          lastError = result.error;
          continue;
        }
        if (result.status === 0) return;
        lastError = new Error(result.stderr || result.stdout || `${cmd} exited with code ${result.status}`);
      }

      throw new Error(
        `OS raw print failed for '${printerName}': ${lastError ? lastError.message : "no lp/lpr command available"}`,
      );
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  const tmpFile = path.join(os.tmpdir(), `matbex-print-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(tmpFile, bytes);

  // PowerShell script: open printer, start RAW doc, WritePrinter bytes, close.
  const ps = `
$ErrorActionPreference = 'Stop'
$printerName = '${printerName.replace(/'/g, "''")}'
$filePath = '${tmpFile.replace(/\\/g, "\\\\").replace(/'/g, "''")}'
$bytes = [System.IO.File]::ReadAllBytes($filePath)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool StartDocPrinter(IntPtr h, int level, [In] ref DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] buf, int n, out int written);
}
"@

$h = [IntPtr]::Zero
if (-not [RawPrinter]::OpenPrinter($printerName, [ref]$h, [IntPtr]::Zero)) { throw "OpenPrinter failed for '$printerName' (err $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
try {
  $di = New-Object RawPrinter+DOCINFO
  $di.pDocName = 'Matbex Receipt'; $di.pDataType = 'RAW'
  if (-not [RawPrinter]::StartDocPrinter($h, 1, [ref]$di)) { throw "StartDocPrinter failed" }
  [RawPrinter]::StartPagePrinter($h) | Out-Null
  $written = 0
  if (-not [RawPrinter]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) { throw "WritePrinter failed" }
  [RawPrinter]::EndPagePrinter($h) | Out-Null
  [RawPrinter]::EndDocPrinter($h) | Out-Null
  Write-Output "OK $written"
} finally {
  [RawPrinter]::ClosePrinter($h) | Out-Null
}
`.trim();

  try {
    const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      encoding: "utf8",
      timeout: 15000,
    });
    if (result.status !== 0) {
      throw new Error(
        `PowerShell raw print failed: ${result.stderr || result.stdout || "unknown error"}`,
      );
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * Print raw ESC/POS bytes.
 * @param {Buffer} bytes
 * @param {{ printer?: string|null }} opts
 */
async function printRawBytes(bytes, opts = {}) {
  let hint = opts.printer || null;
  // "default" is a UI placeholder meaning "auto-detect"; treat as null.
  if (hint && hint.toLowerCase() === "default") hint = null;

  // 1) USB direct path (vid:pid or auto-detected printer-class device)
  const dev = findUsbDevice(hint);
  if (dev && (!hint || VID_PID_RE.test(hint))) {
    try { return await printViaUsb(bytes, dev); }
    catch (err) {
      if (!hint) throw new Error(`USB print failed: ${err.message}`);
      // fall through to spooler if the user passed a named printer
    }
  }

  // 2) Windows spooler / CUPS named printer
  if (hint && !VID_PID_RE.test(hint)) {
    return printViaSpooler(bytes, hint);
  }

  throw new Error(
    "No USB thermal printer detected and no OS printer name supplied. " +
    "Install the thermal printer in Windows (Settings → Printers) and select " +
    "its name in Matbex → Settings → POS Hardware, OR bind the USB device to " +
    "WinUSB with Zadig and pass `printer: \"vid:pid\"`.",
  );
}

async function listPrinters() {
  const out = [];
  // Windows: enumerate spooler printers via PowerShell.
  if (process.platform === "win32") {
    try {
      const ps =
        "Get-Printer | Select-Object -ExpandProperty Name";
      const raw = execSync(`powershell -NoProfile -Command "${ps}"`, {
        encoding: "utf8",
        timeout: 5000,
      });
      for (const line of raw.split(/\r?\n/)) {
        const name = line.trim();
        if (!name) continue;
        out.push({ transport: "spooler", id: name, name });
      }
    } catch { /* ignore — fall through to USB list */ }
  }
  if (usb) {
    for (const d of usb.getDeviceList()) {
      const dd = d.deviceDescriptor;
      out.push({
        transport: "usb",
        id: `${dd.idVendor.toString(16).padStart(4, "0")}:${dd.idProduct.toString(16).padStart(4, "0")}`,
        name: `USB device ${dd.idVendor.toString(16)}:${dd.idProduct.toString(16)}`,
      });
    }
  }
  return out;
}

module.exports = { printRawBytes, listPrinters };