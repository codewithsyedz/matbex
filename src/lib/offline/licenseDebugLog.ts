// Lightweight ring buffer used by the licensing debug panel. Records every
// validate-license outcome and the local terminal/fingerprint snapshot so the
// operator can see exactly *why* this device was activated again.

const KEY = "matbex.license.debuglog";
const MAX = 50;

export interface LicenseDebugEntry {
  ts: number;
  event:
    | "matched_terminal"
    | "rebound_by_fingerprint"
    | "claimed"
    | "recovered_from_unique"
    | "no_seat"
    | "error"
    | "offline_stale";
  mode: string;
  detail: string | null;
  seatId: string | null;
  terminalId: string;
  fingerprintShort: string;
  trigger: "boot" | "interval" | "online" | "manual";
}

export function readLicenseDebugLog(): LicenseDebugEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as LicenseDebugEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendLicenseDebugEntry(entry: LicenseDebugEntry) {
  try {
    const next = [entry, ...readLicenseDebugLog()].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function clearLicenseDebugLog() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}