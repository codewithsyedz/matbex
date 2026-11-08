import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { isDashboardKey } from "@/lib/query/queryKeys";

/**
 * Client-side persistence for frequently used dashboard data.
 *
 * Why: dashboards are revisited constantly (tab switches, route changes,
 * app reloads on tablets). Without persistence every remount refetched the
 * same Supabase aggregates. We persist a small allowlist of read-only,
 * aggregate query keys to sessionStorage so a revisit paints from cache and
 * only revalidates in the background once the data goes stale.
 *
 * sessionStorage (not localStorage) keeps the cache per tab and guarantees it
 * disappears when the browser session ends — no tenant data lingers on shared
 * POS hardware.
 */

export const PERSIST_KEY = "matbex-query-cache";

// Bump when the shape of any persisted query result changes.
export const PERSIST_BUSTER = "v1";

// Max age of restored data. Anything older is dropped and refetched.
export const PERSIST_MAX_AGE = 30 * 60 * 1000; // 30 minutes

/**
 * Only aggregate/read-only dashboard namespaces are persisted — the allowlist
 * comes from the shared key factory, so a new dashboard query is cached
 * consistently without touching this file. Anything involving auth, licensing,
 * devices, chat or write-heavy operational data is deliberately excluded.
 */
export function isPersistableQuery(query: any): boolean {
  if (query.state.status !== "success") return false;
  return isDashboardKey(query.queryKey);
}

function safeStorage(): Storage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const probe = "__mbx_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export const queryPersister = (() => {
  const storage = safeStorage();
  if (!storage) return undefined;
  return createSyncStoragePersister({
    storage,
    key: PERSIST_KEY,
    throttleTime: 1000,
    // Silently drop the cache if it can't be written (quota) instead of throwing.
    retry: () => undefined,
  });
})();

/** Wipe persisted data — used on tenant switch / sign-out. */
export function clearPersistedQueryCache() {
  try {
    window.sessionStorage.removeItem(PERSIST_KEY);
  } catch {
    /* ignore */
  }
}
