export * from "./types";
export * from "./db";
export * from "./connectivity";
export * from "./terminal";
export * from "./crypto";
export * from "./api";
export * from "./syncEngine";
export * from "./posService";
export * from "./backgroundSync";
export * from "./errorCategorization";
export * from "./retryPolicy";
export * from "./checksum";
export { nextLamport, currentLamport } from "./lamport";
export { hydrateAllCaches, resetCacheWatermarks } from "./cacheHydrator";
export { startCacheRealtime } from "./cacheRealtime";
export {
  getMetricsSnapshot,
  refreshQueueDepth,
  resetMetrics,
  summarizeLatency,
  type SyncMetricsSnapshot,
} from "./metrics";

import { configureConnectivity, startConnectivityWatcher } from "./connectivity";
import { wireSyncTriggers } from "./syncEngine";
import { getHealthUrl, getHealthHeaders } from "./api";
import { getTerminalId } from "./terminal";
import { ensurePosSyncWorker, persistSyncCredentials, requestBackgroundSync } from "./backgroundSync";
import { db } from "@/integrations/db/client";

let _bootstrapped = false;
let _branchId: string | null = null;
let _terminalId: string | null = null;

/** Call once at app startup with the current restaurant id. Safe to call multiple times. */
export async function bootstrapOffline(branchId: string | null) {
  _branchId = branchId;
  if (_bootstrapped) return;
  _bootstrapped = true;
  configureConnectivity({ healthUrl: getHealthUrl(), healthHeaders: getHealthHeaders() });
  startConnectivityWatcher();
  _terminalId = await getTerminalId();
  wireSyncTriggers(() => ({ branchId: _branchId, terminalId: _terminalId }));

  // Register the background-sync Service Worker (no-op in iframes/previews)
  // and persist credentials it needs to drain the queue with the tab closed.
  await ensurePosSyncWorker();
  await persistSyncCredentials({ branchId: _branchId, terminalId: _terminalId });

  // Refresh the cached JWT for the SW whenever auth state changes.
  db.auth.onAuthStateChange(() => {
    void persistSyncCredentials({ branchId: _branchId, terminalId: _terminalId });
  });

  // Ask the SW to drain anything that was left over from a previous session.
  void requestBackgroundSync();
}

export function setOfflineBranchId(id: string | null) {
  _branchId = id;
  // Keep the SW's view of the active branch fresh.
  void persistSyncCredentials({ branchId: id, terminalId: _terminalId });
}