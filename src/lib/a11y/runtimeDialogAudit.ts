/**
 * Runtime accessibility audit for Radix dialog-family components.
 *
 * When enabled, observes the DOM for elements with `role="dialog"` /
 * `role="alertdialog"` (which Radix sets on `*PrimitiveContent` portals)
 * and inspects whether each one is properly described:
 *
 *   - status: "ok"        - has aria-describedby → element with meaningful text
 *   - status: "generic"   - has aria-describedby, but the text matches one of
 *                            our sr-only fallbacks ("Dialog", "Sheet", "Drawer",
 *                            "Confirmation")
 *   - status: "missing"   - no aria-describedby, or it points to empty text
 *
 * The state is exposed via a tiny pub-sub store so React components can
 * subscribe via `useSyncExternalStore`.
 */

export type AuditStatus = "ok" | "generic" | "missing";

export interface AuditFinding {
  /** Stable per-mount id (incrementing) - used as React key. */
  id: number;
  /** Underlying ARIA role of the surface. */
  role: "dialog" | "alertdialog";
  /** Resolved title from aria-labelledby, when available. */
  title: string | null;
  /** Resolved description from aria-describedby, when available. */
  descriptionText: string | null;
  status: AuditStatus;
  /** ISO timestamp of when this surface was first observed. */
  openedAt: string;
  /** Pathname of the route the surface opened on. */
  route: string;
}

const STORAGE_KEY = "matbex:a11y-runtime-audit";
const URL_PARAM = "a11yAudit";

const GENERIC_FALLBACKS = new Set([
  "Dialog",
  "Sheet",
  "Drawer",
  "Confirmation",
]);

interface AuditState {
  enabled: boolean;
  findings: AuditFinding[];
}

type Listener = () => void;

let state: AuditState = { enabled: false, findings: [] };
const listeners = new Set<Listener>();
let observer: MutationObserver | null = null;
let nextId = 1;
// Track DOM nodes we've already processed to avoid duplicate findings when
// Radix mutates attributes after mount.
const seenNodes = new WeakSet<Element>();

function notify() {
  for (const l of listeners) l();
}

function persist() {
  try {
    if (typeof window === "undefined") return;
    if (state.enabled) {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

function readPersistedEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(URL_PARAM) === "1") return true;
    if (url.searchParams.get(URL_PARAM) === "0") return false;
  } catch {
    // ignore URL parsing errors
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function textOfIdRefs(idRefs: string | null): string | null {
  if (!idRefs) return null;
  const ids = idRefs.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) {
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    }
  }
  if (parts.length === 0) return null;
  return parts.join(" ");
}

function classify(descriptionText: string | null): AuditStatus {
  if (!descriptionText) return "missing";
  if (GENERIC_FALLBACKS.has(descriptionText)) return "generic";
  return "ok";
}

function inspect(el: Element) {
  if (seenNodes.has(el)) return;
  const role = el.getAttribute("role");
  if (role !== "dialog" && role !== "alertdialog") return;
  seenNodes.add(el);

  // Defer one tick so Radix has time to wire aria-describedby/labelledby and
  // mount the (sr-only) description node.
  window.requestAnimationFrame(() => {
    const title = textOfIdRefs(el.getAttribute("aria-labelledby"));
    const descriptionText = textOfIdRefs(el.getAttribute("aria-describedby"));
    const status = classify(descriptionText);

    const finding: AuditFinding = {
      id: nextId++,
      role,
      title,
      descriptionText,
      status,
      openedAt: new Date().toISOString(),
      route: window.location.pathname + window.location.search,
    };

    // Cap findings list to prevent unbounded growth.
    const next = [finding, ...state.findings].slice(0, 200);
    state = { ...state, findings: next };
    notify();
  });
}

function scanSubtree(root: ParentNode) {
  // Scan the root itself and all dialog descendants.
  if (root instanceof Element) inspect(root);
  const nodes = root.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  nodes.forEach(inspect);
}

function startObserver() {
  if (observer || typeof document === "undefined") return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scanSubtree(node as Element);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Capture anything already in the DOM at start time.
  scanSubtree(document.body);
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

export const runtimeDialogAudit = {
  getState(): AuditState {
    return state;
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  enable() {
    if (state.enabled) return;
    state = { ...state, enabled: true };
    persist();
    startObserver();
    notify();
  },
  disable() {
    if (!state.enabled) return;
    state = { ...state, enabled: false };
    persist();
    stopObserver();
    notify();
  },
  toggle() {
    state.enabled ? this.disable() : this.enable();
  },
  clear() {
    state = { ...state, findings: [] };
    notify();
  },
  /** Bootstrap once on app start: re-enable if previously persisted. */
  bootstrap() {
    if (typeof window === "undefined") return;
    if (readPersistedEnabled()) {
      this.enable();
    }
  },
};

export type { AuditState };