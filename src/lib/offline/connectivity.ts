// =====================================================================
// Connectivity service
// ---------------------------------------------------------------------
// - Uses navigator.onLine as a hint, NOT as truth.
// - Periodically pings a real endpoint when offline (default: every 30s).
// - Emits "online" / "offline" events to subscribers.
// - Triggers immediate re-check on browser online/offline events.
// =====================================================================

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();
let currentOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
let pingTimer: number | null = null;
let healthUrl = "";
let healthHeaders: Record<string, string> = {};

export function configureConnectivity(opts: { healthUrl: string; healthHeaders?: Record<string, string> }) {
  healthUrl = opts.healthUrl;
  healthHeaders = opts.healthHeaders ?? {};
}

export function isOnline(): boolean {
  return currentOnline;
}

export function subscribeConnectivity(fn: Listener): () => void {
  listeners.add(fn);
  fn(currentOnline);
  return () => listeners.delete(fn);
}

function setOnline(next: boolean) {
  if (next === currentOnline) return;
  currentOnline = next;
  listeners.forEach((l) => {
    try {
      l(next);
    } catch {
      /* ignore */
    }
  });
}

/** Real network probe. Falls back to root if no health endpoint. */
export async function probeNetwork(timeoutMs = 4000): Promise<boolean> {
  if (!healthUrl) {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    return currentOnline;
  }
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
      headers: healthHeaders,
    });
    const ok = res.ok;
    setOnline(ok);
    return ok;
  } catch {
    setOnline(false);
    return false;
  } finally {
    clearTimeout(id);
  }
}

function startPolling() {
  if (pingTimer != null) return;
  pingTimer = window.setInterval(() => {
    // Only poll when we believe we're offline; if online, browser will tell us.
    if (!currentOnline) probeNetwork();
  }, 30000);
}

export function startConnectivityWatcher() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => probeNetwork());
  window.addEventListener("offline", () => setOnline(false));
  startPolling();
  // Initial probe
  probeNetwork();
}