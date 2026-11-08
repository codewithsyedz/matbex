// Ring-buffer log of every revoke-device-license attempt so operators can
// inspect the full request/response payload when a revoke fails and quickly
// share it with support.

const KEY = "matbex.revoke.diagnostics";
const MAX = 25;

export interface RevokeDiagnosticEntry {
  ts: number;
  deviceId: string;
  durationMs: number;
  ok: boolean;
  request: {
    functionName: string;
    body: Record<string, unknown>;
    origin: string;
    userAgent: string;
    online: boolean;
  };
  response: {
    status?: number;
    data?: unknown;
    error?: {
      name?: string;
      message?: string;
      context?: unknown;
    } | null;
  };
}

export function readRevokeDiagnostics(): RevokeDiagnosticEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RevokeDiagnosticEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendRevokeDiagnostic(entry: RevokeDiagnosticEntry) {
  try {
    const next = [entry, ...readRevokeDiagnostics()].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
}

export function clearRevokeDiagnostics() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}