// =====================================================================
// Background Sync registration
// ---------------------------------------------------------------------
// - Registers public/sw-pos-sync.js with a dedicated scope (/pos-sync)
//   so it never intercepts navigations.
// - Persists the credentials the SW needs (auth token, terminal,
//   branch, Supabase URL/anon) into IndexedDB KV - the SW reads them
//   from there at sync time, the page does NOT need to be open.
// - Exposes:
//     ensurePosSyncWorker()      -> idempotent registration
//     requestBackgroundSync()    -> ask the SW to drain ASAP
//     persistSyncCredentials()   -> refresh the JWT/branch/etc.
// =====================================================================

import { supabase } from "@/integrations/supabase/client";
import { kvSet } from "./db";

const SW_URL = "/sw-pos-sync.js";
const SW_SCOPE = "/pos-sync/"; // virtual scope, no real route lives here
const SYNC_TAG = "pos-sync";
const PERIODIC_TAG = "pos-sync-periodic";

let _registration: ServiceWorkerRegistration | null = null;
let _registerPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/** True only outside Lovable previews/iframes (matches PWA guidance). */
function shouldRegisterSW(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  const inIframe = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();
  const host = window.location.hostname;
  const isPreview =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host.includes("lovable.app") && host.includes("--");
  return !inIframe && !isPreview;
}

export async function ensurePosSyncWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!shouldRegisterSW()) return null;
  if (_registration) return _registration;
  if (_registerPromise) return _registerPromise;
  _registerPromise = (async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
      _registration = reg;

      // Periodic Background Sync (Chromium, requires installed PWA + permission).
      try {
        const perm = await (navigator as any).permissions?.query?.({
          name: "periodic-background-sync" as PermissionName,
        });
        if (perm?.state === "granted" && (reg as any).periodicSync?.register) {
          await (reg as any).periodicSync.register(PERIODIC_TAG, {
            minInterval: 15 * 60 * 1000, // 15 min - browser may throttle further
          });
        }
      } catch { /* feature unavailable */ }

      // Page<->SW messages: bubble drain results to the UI as a custom event.
      navigator.serviceWorker.addEventListener("message", (e) => {
        const data = (e as MessageEvent).data;
        if (data?.type === "pos-sync-drained") {
          window.dispatchEvent(new CustomEvent("pos-sync-drained", { detail: data }));
        }
      });

      return reg;
    } catch (err) {
      console.warn("[pos-sync] SW registration failed:", err);
      return null;
    }
  })();
  return _registerPromise;
}

/** Persist everything the SW needs to call pos-sync without the page open. */
export async function persistSyncCredentials(opts: {
  branchId: string | null;
  terminalId: string | null;
}) {
  if (opts.branchId) await kvSet("pos.branch_id", opts.branchId);
  if (opts.terminalId) await kvSet("pos.terminal_id", opts.terminalId);
  await kvSet("pos.supabase_url", import.meta.env.VITE_SUPABASE_URL as string);
  await kvSet("pos.supabase_anon", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string);

  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) {
    await kvSet("pos.auth_token", {
      access_token: data.session.access_token,
      refreshed_at: new Date().toISOString(),
    });
  }
}

/**
 * Ask the browser to drain the queue.
 * - Preferred path: SyncManager.register("pos-sync") -> survives tab close.
 * - Fallback: postMessage to the active SW (Safari + browsers w/o Sync API).
 * - Last resort: returns false so the caller can fall back to in-page sync.
 */
export async function requestBackgroundSync(): Promise<boolean> {
  const reg = await ensurePosSyncWorker();
  if (!reg) return false;
  try {
    if ("sync" in reg && (reg as any).sync?.register) {
      await (reg as any).sync.register(SYNC_TAG);
      return true;
    }
  } catch (err) {
    console.warn("[pos-sync] sync.register failed, falling back to message:", err);
  }
  try {
    const sw = reg.active || (await navigator.serviceWorker.ready).active;
    sw?.postMessage({ type: "pos-sync-now" });
    return !!sw;
  } catch {
    return false;
  }
}