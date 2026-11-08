/**
 * Lightweight runtime performance profiler.
 *
 * Records three signal types so we can tell *what* blocked a dashboard paint:
 *  - `query`  : React Query fetches (duration + why they ran)
 *  - `render` : React commit timings from <ProfilerBoundary>
 *  - `task`   : main-thread long tasks (>50ms) via PerformanceObserver
 *
 * Zero cost when disabled: nothing subscribes and no observers are installed.
 */

export type PerfKind = "query" | "render" | "task";

export interface PerfEvent {
  id: string;
  kind: PerfKind;
  /** Query key / component id / task name */
  label: string;
  /** Milliseconds */
  duration: number;
  /** Why this happened: "mount", "update", "fetch", "refetch", "long task" */
  reason: string;
  at: number;
  /** Extra human-readable detail (cache status, observer count, ...) */
  detail?: string;
}

const STORAGE_KEY = "matbex.perfProfiler.enabled";
const MAX_EVENTS = 300;
/** Anything slower than this is highlighted as a blocker. */
export const SLOW_MS = 200;

interface PerfState {
  enabled: boolean;
  events: PerfEvent[];
}

let state: PerfState = { enabled: false, events: [] };
const listeners = new Set<() => void>();
let seq = 0;
let longTaskObserver: PerformanceObserver | null = null;
let bootstrapped = false;

function emit() {
  listeners.forEach((l) => l());
}

function setState(next: Partial<PerfState>) {
  state = { ...state, ...next };
  emit();
}

function startLongTaskObserver() {
  if (longTaskObserver || typeof PerformanceObserver === "undefined") return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perfProfiler.record({
          kind: "task",
          label: entry.name || "long task",
          duration: Math.round(entry.duration),
          reason: "main thread blocked",
        });
      }
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    longTaskObserver = null;
  }
}

function stopLongTaskObserver() {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
}

export const perfProfiler = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  getState() {
    return state;
  },

  isEnabled() {
    return state.enabled;
  },

  /** Reads ?perf=1 / localStorage once on app start. */
  bootstrap() {
    if (bootstrapped || typeof window === "undefined") return;
    bootstrapped = true;
    let enabled = false;
    try {
      const param = new URLSearchParams(window.location.search).get("perf");
      if (param === "1" || param === "true") enabled = true;
      else if (param === "0" || param === "false") enabled = false;
      else enabled = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      enabled = false;
    }
    if (enabled) this.enable();
  },

  enable() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    startLongTaskObserver();
    setState({ enabled: true });
  },

  disable() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    stopLongTaskObserver();
    setState({ enabled: false, events: [] });
  },

  clear() {
    setState({ events: [] });
  },

  record(event: Omit<PerfEvent, "id" | "at">) {
    if (!state.enabled) return;
    const next: PerfEvent = { ...event, id: `${++seq}`, at: Date.now() };
    setState({ events: [next, ...state.events].slice(0, MAX_EVENTS) });
  },
};

export function summarize(events: PerfEvent[]) {
  const byLabel = new Map<string, { label: string; kind: PerfKind; count: number; total: number; max: number }>();
  for (const e of events) {
    const key = `${e.kind}:${e.label}`;
    const row = byLabel.get(key) ?? { label: e.label, kind: e.kind, count: 0, total: 0, max: 0 };
    row.count += 1;
    row.total += e.duration;
    row.max = Math.max(row.max, e.duration);
    byLabel.set(key, row);
  }
  return [...byLabel.values()].sort((a, b) => b.total - a.total);
}
