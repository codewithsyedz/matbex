/**
 * Temporary diagnostics for route-guard driven navigation.
 *
 * Records every decision ProtectedRoute makes (allow / redirect / wait) into an
 * in-memory ring buffer plus sessionStorage so we can inspect back-and-forth
 * navigation loops at /debug/routing.
 *
 * Enable verbose console output with `?debugRoutes=1` or
 * localStorage.setItem("matbex:debugRoutes", "1").
 */

export type RouteGuardDecision = "allow" | "redirect" | "wait" | "block" | "nav";

export interface RouteGuardLogEntry {
  id: string;
  ts: number;
  pathname: string;
  search: string;
  decision: RouteGuardDecision;
  reason: string;
  to?: string;
  context?: Record<string, unknown>;
}

const MAX_ENTRIES = 200;
const STORAGE_KEY = "matbex:routeGuardLog";
const FLAG_KEY = "matbex:debugRoutes";

let buffer: RouteGuardLogEntry[] = [];
const listeners = new Set<(entries: RouteGuardLogEntry[]) => void>();

function safeSession(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function hydrate() {
  const s = safeSession();
  if (!s) return;
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (raw) buffer = JSON.parse(raw) as RouteGuardLogEntry[];
  } catch {
    buffer = [];
  }
}
hydrate();

function persist() {
  const s = safeSession();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-MAX_ENTRIES)));
  } catch {
    /* quota — ignore, in-memory buffer still works */
  }
}

export function isRouteDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("debugRoutes") === "1") {
      window.localStorage.setItem(FLAG_KEY, "1");
      return true;
    }
    return window.localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setRouteDebugEnabled(enabled: boolean) {
  try {
    if (enabled) window.localStorage.setItem(FLAG_KEY, "1");
    else window.localStorage.removeItem(FLAG_KEY);
  } catch {
    /* ignore */
  }
}

export function logRouteGuard(entry: Omit<RouteGuardLogEntry, "id" | "ts">) {
  const full: RouteGuardLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  };

  // Collapse consecutive identical "allow"/"wait" decisions on the same path to
  // keep the buffer readable during re-renders.
  const last = buffer[buffer.length - 1];
  if (
    last &&
    last.decision === full.decision &&
    last.pathname === full.pathname &&
    last.reason === full.reason &&
    last.to === full.to &&
    full.ts - last.ts < 400
  ) {
    return;
  }

  buffer = [...buffer, full].slice(-MAX_ENTRIES);
  persist();
  listeners.forEach(l => l(buffer));

  if (isRouteDebugEnabled()) {
     
    console.info(
      `[route-guard] ${full.decision.toUpperCase()} ${full.pathname}${full.to ? ` -> ${full.to}` : ""} (${full.reason})`,
      full.context ?? {}
    );
  }
}

export function getRouteGuardLog(): RouteGuardLogEntry[] {
  return buffer;
}

export function clearRouteGuardLog() {
  buffer = [];
  persist();
  listeners.forEach(l => l(buffer));
}

export function subscribeRouteGuardLog(fn: (entries: RouteGuardLogEntry[]) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Detects rapid A -> B -> A redirect loops within the recent window. */
export function detectRedirectLoops(entries: RouteGuardLogEntry[] = buffer) {
  const redirects = entries.filter(e => e.decision === "redirect" && e.to);
  const counts = new Map<string, { pair: string; count: number; lastTs: number; reasons: Set<string> }>();
  for (const r of redirects) {
    const key = `${r.pathname} -> ${r.to}`;
    const cur = counts.get(key) ?? { pair: key, count: 0, lastTs: 0, reasons: new Set<string>() };
    cur.count += 1;
    cur.lastTs = Math.max(cur.lastTs, r.ts);
    cur.reasons.add(r.reason);
    counts.set(key, cur);
  }
  return Array.from(counts.values())
    .filter(c => c.count >= 3)
    .map(c => ({ pair: c.pair, count: c.count, lastTs: c.lastTs, reasons: Array.from(c.reasons) }))
    .sort((a, b) => b.count - a.count);
}
