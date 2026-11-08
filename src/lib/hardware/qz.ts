// =====================================================================
// QZ Tray loader
// ---------------------------------------------------------------------
// Lazy-loads the QZ Tray browser SDK from the local desktop bridge and
// exposes a singleton connection. QZ Tray must be running on the host
// (https://qz.io). The script is loaded from the official CDN on first
// use; if it fails the adapter reports `isSupported() === false` so
// callers can fall back to browser printing.
// =====================================================================

const QZ_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";

type QZApi = {
  websocket: {
    connect: (opts?: Record<string, unknown>) => Promise<void>;
    disconnect: () => Promise<void>;
    isActive: () => boolean;
  };
  printers: {
    find: () => Promise<string[] | string>;
    getDefault: () => Promise<string>;
  };
  configs: {
    create: (printer: string, opts?: Record<string, unknown>) => unknown;
  };
  print: (config: unknown, data: unknown[]) => Promise<void>;
  security?: {
    setCertificatePromise: (cb: (resolve: () => void) => void) => void;
    setSignaturePromise: (cb: () => (resolve: () => void) => void) => void;
  };
};

declare global {
  interface Window {
    qz?: QZApi;
  }
}

let _loadPromise: Promise<QZApi | null> | null = null;

function loadScriptOnce(): Promise<QZApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.qz) return Promise.resolve(window.qz);
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-qz="1"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.qz ?? null));
      existing.addEventListener("error", () => resolve(null));
      return;
    }
    const s = document.createElement("script");
    s.src = QZ_SCRIPT_URL;
    s.async = true;
    s.dataset.qz = "1";
    s.onload = () => resolve(window.qz ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return _loadPromise;
}

let _connectPromise: Promise<QZApi | null> | null = null;

export async function getQZ(): Promise<QZApi | null> {
  const api = await loadScriptOnce();
  if (!api) return null;

  // Configure unsigned dev mode - production deployments should sign requests.
  if (api.security && !(api as unknown as { __matbexConfigured?: boolean }).__matbexConfigured) {
    api.security.setCertificatePromise((resolve) => resolve());
    api.security.setSignaturePromise(() => (resolve) => resolve());
    (api as unknown as { __matbexConfigured?: boolean }).__matbexConfigured = true;
  }

  if (api.websocket.isActive()) return api;
  if (_connectPromise) return _connectPromise;
  _connectPromise = api.websocket
    .connect({ retries: 0, delay: 0 })
    .then(() => api)
    .catch(() => {
      _connectPromise = null;
      return null;
    });
  return _connectPromise;
}

export async function disconnectQZ(): Promise<void> {
  if (typeof window === "undefined") return;
  const api = window.qz;
  if (api && api.websocket.isActive()) {
    try {
      await api.websocket.disconnect();
    } catch {
      // ignore
    }
  }
  _connectPromise = null;
}