// =====================================================================
// Sync engine
// ---------------------------------------------------------------------
// - Drains sync_queue items in dependency order.
// - Idempotent retries with exponential backoff.
// - Marks items SYNCED / FAILED / FAILED_VALIDATION.
// - Emits events for the UI status badge + Sync Center.
// =====================================================================

import { getAll, put, remove, STORES, kvSet, kvGet } from "./db";
import type { OfflineRecord, SyncQueueItem, ConnectivityStatus } from "./types";
import { postSyncBatch, type SyncResultItem, type SyncTrace } from "./api";
import { isOnline, subscribeConnectivity } from "./connectivity";
import { unprotectPayload } from "./crypto";
import { categorizeQueueError } from "./errorCategorization";
import { getRetryPolicy, nextRetryAtIso } from "./retryPolicy";
import { isFeatureFlagEnabled } from "@/hooks/useFeatureFlags";
import { recordBatchSuccess, recordBatchFailure, refreshQueueDepth } from "./metrics";
import { reportFailedSyncItem } from "./dlq";

/** Epic B3 — max events per HTTP call. Larger queues drain in multiple calls. */
export const MAX_BATCH_SIZE = 25;

// Per-category retry scheduling lives in ./retryPolicy. The constants
// below are only used as a last-ditch fallback when categorisation fails.
const FALLBACK_MAX_RETRIES = 6;

type StatusListener = (s: { status: ConnectivityStatus; pending: number; failed: number }) => void;
const statusListeners = new Set<StatusListener>();

let isRunning = false;
let lastStatus: ConnectivityStatus = "online";

export function subscribeSyncStatus(fn: StatusListener) {
  statusListeners.add(fn);
  // Push current snapshot lazily
  void emitStatus();
  return () => statusListeners.delete(fn);
}

/** Force a status re-emit (useful after the SW drains the queue). */
export async function refreshSyncStatus() {
  await emitStatus();
}

async function emitStatus(forced?: ConnectivityStatus) {
  const queue = await getAll<SyncQueueItem>(STORES.queue);
  const pending = queue.filter((q) => q.status === "PENDING" || q.status === "SYNCING").length;
  const failed = queue.filter((q) => q.status === "FAILED" || q.status === "FAILED_VALIDATION").length;
  let status: ConnectivityStatus = forced ?? lastStatus;
  if (!forced) {
    if (!isOnline()) status = "offline";
    else if (failed > 0 && pending === 0) status = "sync-failed";
    else if (pending > 0 && isRunning) status = "syncing";
    else status = "online";
  }
  lastStatus = status;
  statusListeners.forEach((l) => l({ status, pending, failed }));
}

export async function getQueueSnapshot() {
  const queue = await getAll<SyncQueueItem>(STORES.queue);
  return queue.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getLastSyncedAt(): Promise<string | null> {
  return ((await kvGet<string>("pos.last_synced_at")) as string) ?? null;
}

function isValidationError(message: string) {
  return /validation|invalid|missing|forbidden|409|422/i.test(message);
}

/** Find the offline record for a queue item across all entity stores. */
async function loadRecord(qi: SyncQueueItem): Promise<OfflineRecord | undefined> {
  const map: Record<SyncQueueItem["entity_type"], string> = {
    ORDER: STORES.orders,
    PAYMENT: STORES.payments,
    INVOICE: STORES.invoices,
    RETURN: STORES.returns,
    CASH_DRAWER: STORES.cashDrawer,
  };
  const store = map[qi.entity_type];
  const all = await getAll<OfflineRecord>(store as any);
  return all.find((r) => r.local_id === qi.entity_local_id);
}

/**
 * How long an item may sit in SYNCING before we consider the upload dead
 * (tab reloaded / process killed mid-flight) and hand it back to the queue.
 */
export const STUCK_SYNCING_MS = 90_000;

/**
 * Reclaim items stuck mid-upload: anything left in SYNCING whose last attempt
 * is older than `staleMs` goes back to PENDING and becomes immediately due.
 * Idempotent, safe to call on boot and before every drain.
 */
export async function reclaimStuckSyncingItems(staleMs = STUCK_SYNCING_MS): Promise<number> {
  const all = await getAll<SyncQueueItem>(STORES.queue);
  const cutoff = Date.now() - staleMs;
  let reclaimed = 0;
  for (const qi of all) {
    if (qi.status !== "SYNCING") continue;
    const last = qi.last_attempt_at ? new Date(qi.last_attempt_at).getTime() : 0;
    if (last > cutoff) continue; // still plausibly in flight
    qi.status = "PENDING";
    qi.next_retry_at = null; // retry on the very next sweep
    qi.error_message = qi.error_message ?? "Upload interrupted - retrying";
    await put(STORES.queue, qi);
    reclaimed += 1;
  }
  if (reclaimed > 0) await emitStatus();
  return reclaimed;
}

/** Public: kick the sync engine. Safe to call repeatedly. */
export async function runSync(opts: { branchId: string; terminalId: string }): Promise<void> {
  if (isRunning) return;
  if (!isOnline()) return;
  isRunning = true;
  await emitStatus("syncing");

  try {
    // Hand back anything abandoned mid-upload by a previous run/reload.
    await reclaimStuckSyncingItems();

    // Tenant isolation: only drain queue items whose underlying record
    // belongs to the currently active branch. Items from other tenants
    // stay in IndexedDB untouched and will be drained when the user
    // switches back to that branch - they MUST NEVER be sent under the
    // current branch's auth context.
    const allQueue = (await getAll<SyncQueueItem>(STORES.queue))
      .filter((q) => q.status === "PENDING" || q.status === "FAILED")
      .sort((a, b) => {
        const order = { ORDER: 0, PAYMENT: 1, INVOICE: 2, CASH_DRAWER: 3, RETURN: 4 };
        return (order[a.entity_type] ?? 9) - (order[b.entity_type] ?? 9);
      });

    const queue: SyncQueueItem[] = [];
    for (const qi of allQueue) {
      const rec = await loadRecord(qi);
      if (!rec) {
        // Orphaned -> drop, no tenant to attribute it to.
        await remove(STORES.queue, qi.queue_id);
        continue;
      }
      if (rec.branch_id !== opts.branchId) continue; // belongs to another tenant
      queue.push(qi);
    }

    if (queue.length === 0) {
      await kvSet("pos.last_synced_at", new Date().toISOString());
      return;
    }

    // Skip items whose backoff hasn't expired.
    const now = Date.now();
    const due = queue.filter(
      (q) => !q.next_retry_at || new Date(q.next_retry_at).getTime() <= now,
    );
    if (due.length === 0) return;

    // Build batch
    const batchItems = [];
    const recordIndex = new Map<string, OfflineRecord>();
    for (const qi of due) {
      const rec = await loadRecord(qi);
      if (!rec) {
        // Orphaned queue item -> drop
        await remove(STORES.queue, qi.queue_id);
        continue;
      }
      recordIndex.set(qi.queue_id, rec);
      const payload = await unprotectPayload(rec.payload as any);
      qi.status = "SYNCING";
      qi.last_attempt_at = new Date().toISOString();
      await put(STORES.queue, qi);
      batchItems.push({
        idempotency_key: qi.idempotency_key,
        entity_type: qi.entity_type,
        operation: qi.operation,
        payload: payload as any,
        dependency_key: qi.dependency_key ?? null,
      });
    }
    if (batchItems.length === 0) return;

    // Epic B4 — feature flag toggles batched vs. single-item path. Default ON.
    // When disabled, we still call /pos-sync but with one event per request so
    // ops can isolate a poisoned event.
    const batchEnabled = isFeatureFlagEnabled("offline_batch_sync", null, true);
    const chunkSize = batchEnabled ? MAX_BATCH_SIZE : 1;

    // Chunk into MAX_BATCH_SIZE-sized calls (Epic B3).
    const chunks: typeof batchItems[] = [];
    for (let i = 0; i < batchItems.length; i += chunkSize) {
      chunks.push(batchItems.slice(i, i + chunkSize));
    }

    let results: SyncResultItem[] = [];
    let lastTrace: SyncTrace | null = null;
    const traceByKey = new Map<string, SyncTrace>();
    try {
      for (const chunk of chunks) {
        const t0 = performance.now();
        try {
          const chunkResults = await postSyncBatch({
            branchId: opts.branchId,
            terminalId: opts.terminalId,
            items: chunk,
            onTrace: (t) => {
              lastTrace = t;
              for (const k of t.idempotency_keys) traceByKey.set(k, t);
            },
          });
          const latency = performance.now() - t0;
          void recordBatchSuccess(chunk.length, latency);
          results = results.concat(chunkResults);
        } catch (err) {
          const latency = performance.now() - t0;
          void recordBatchFailure(chunk.length, latency, (err as Error).message ?? "network error");
          throw err;
        }
      }
    } catch (err) {
      // Network/server failure -> reset items to PENDING with backoff
      const errMsg = (err as Error).message ?? "network error";
      const failTrace = (err as { trace?: SyncTrace }).trace ?? lastTrace;
      for (const qi of due) {
        qi.status = "PENDING";
        qi.retry_count += 1;
        qi.error_message = errMsg;
        const cat = categorizeQueueError(qi);
        const policy = getRetryPolicy(cat.id);
        qi.next_retry_at = nextRetryAtIso(cat.id, qi.retry_count);
        if (qi.retry_count >= (policy.maxRetries || FALLBACK_MAX_RETRIES)) {
          qi.status = "FAILED";
          const rec = recordIndex.get(qi.queue_id);
          if (rec) {
            void reportFailedSyncItem(qi, rec, errMsg, {
              inputPayload: rec,
              errorCategory: cat.id,
              trace: failTrace ?? null,
              maxRetries: policy.maxRetries || FALLBACK_MAX_RETRIES,
              retryExhausted: true,
              lastAttempt: {
                attempted_at: new Date().toISOString(),
                attempt_number: qi.retry_count,
                http_status: failTrace?.http_status ?? null,
                response_body: failTrace?.response_body ?? null,
                retryable: cat.retryable,
                next_retry_at: null,
                category: cat.id,
              },
            });
          }
        }
        await put(STORES.queue, qi);
      }
      await emitStatus("sync-failed");
      return;
    }

    // Apply per-item results
    const byKey = new Map<string, SyncResultItem>(results.map((r) => [r.idempotency_key, r]));
    for (const qi of due) {
      const r = byKey.get(qi.idempotency_key);
      const rec = recordIndex.get(qi.queue_id);
      if (!r || !rec) {
        // Server returned no verdict for this item: never leave it SYNCING,
        // put it back in the queue so the next sweep retries it.
        if (qi.status === "SYNCING") {
          qi.status = "PENDING";
          qi.retry_count += 1;
          qi.error_message = "No server response for this item - retrying";
          const cat = categorizeQueueError({ ...qi, error_message: qi.error_message });
          qi.next_retry_at = nextRetryAtIso(cat.id, qi.retry_count);
          await put(STORES.queue, qi);
        }
        continue;
      }


      if (r.status === "ok" || r.status === "duplicate") {
        rec.server_id = r.server_id ?? rec.server_id;
        rec.status = "SYNCED";
        rec.synced_at = new Date().toISOString();
        rec.updated_at = rec.synced_at;
        rec.error_message = null;
        await put(entityStoreFor(qi.entity_type), rec);
        await remove(STORES.queue, qi.queue_id);
      } else {
        const msg = r.error ?? "unknown server error";
        qi.error_message = msg;
        qi.retry_count += 1;
        const cat = categorizeQueueError({ ...qi, error_message: msg });
        const policy = getRetryPolicy(cat.id);
        const validationErrors =
          (r as any).validation_errors ?? (r as any).details ?? null;
        const itemTrace = traceByKey.get(qi.idempotency_key) ?? lastTrace;
        const dlqExtras = {
          inputPayload: rec,
          validationErrors,
          errorCategory: cat.id,
          trace: itemTrace ?? null,
          maxRetries: policy.maxRetries || FALLBACK_MAX_RETRIES,
          retryExhausted: qi.retry_count >= (policy.maxRetries || FALLBACK_MAX_RETRIES),
          lastAttempt: {
            attempted_at: new Date().toISOString(),
            attempt_number: qi.retry_count,
            http_status: (r as any).http_status ?? itemTrace?.http_status ?? null,
            response_body: (r as any).response ?? itemTrace?.response_body ?? null,
            retryable: cat.retryable && !isValidationError(msg),
            next_retry_at: qi.next_retry_at ?? null,
            category: cat.id,
          },
        };
        if (!cat.retryable || isValidationError(msg)) {
          qi.status = isValidationError(msg) ? "FAILED_VALIDATION" : "FAILED";
          qi.next_retry_at = null;
          await put(STORES.failed, qi);
          void reportFailedSyncItem(qi, rec, msg, dlqExtras);
        } else if (qi.retry_count >= (policy.maxRetries || FALLBACK_MAX_RETRIES)) {
          qi.status = "FAILED";
          qi.next_retry_at = null;
          await put(STORES.failed, qi);
          void reportFailedSyncItem(qi, rec, msg, dlqExtras);
        } else {
          qi.status = "PENDING";
          qi.next_retry_at = nextRetryAtIso(cat.id, qi.retry_count);
        }
        await put(STORES.queue, qi);
        rec.status = qi.status;
        rec.error_message = msg;
        rec.updated_at = new Date().toISOString();
        await put(entityStoreFor(qi.entity_type), rec);
      }
    }

    await kvSet("pos.last_synced_at", new Date().toISOString());
  } finally {
    isRunning = false;
    void refreshQueueDepth();
    await emitStatus();
  }
}

function entityStoreFor(t: SyncQueueItem["entity_type"]) {
  switch (t) {
    case "ORDER":
      return STORES.orders;
    case "PAYMENT":
      return STORES.payments;
    case "INVOICE":
      return STORES.invoices;
    case "CASH_DRAWER":
      return STORES.cashDrawer;
    case "RETURN":
      return STORES.returns;
  }
}

/** Manually retry one failed item from the Sync Center UI. */
export async function retryQueueItem(queueId: string) {
  const all = await getAll<SyncQueueItem>(STORES.queue);
  const qi = all.find((q) => q.queue_id === queueId);
  if (!qi) return;
  qi.status = "PENDING";
  qi.retry_count = 0;
  qi.next_retry_at = null;
  qi.error_message = null;
  await put(STORES.queue, qi);
  await remove(STORES.failed, queueId).catch(() => {});
  await emitStatus();
}

/**
 * Manual override: force a single queue item to be retried *immediately*,
 * bypassing its category-specific backoff window. The retry counter is
 * preserved so we don't accidentally extend the policy budget.
 */
export async function forceRetryQueueItem(queueId: string) {
  const all = await getAll<SyncQueueItem>(STORES.queue);
  const qi = all.find((q) => q.queue_id === queueId);
  if (!qi) return;
  qi.status = "PENDING";
  qi.next_retry_at = null;
  qi.error_message = null;
  await put(STORES.queue, qi);
  await remove(STORES.failed, queueId).catch(() => {});
  await emitStatus();
}

/** Retry every failed item. */
export async function retryAllFailed() {
  const all = await getAll<SyncQueueItem>(STORES.queue);
  for (const qi of all) {
    if (qi.status === "FAILED" || qi.status === "FAILED_VALIDATION") {
      qi.status = "PENDING";
      qi.retry_count = 0;
      qi.next_retry_at = null;
      qi.error_message = null;
      await put(STORES.queue, qi);
      await remove(STORES.failed, qi.queue_id).catch(() => {});
    }
  }
  await emitStatus();
}

/** Wire the engine: re-sync when connection comes back. */
export function wireSyncTriggers(getCtx: () => { branchId: string | null; terminalId: string | null }) {
  // Anything abandoned mid-upload by a previous session is queued again at boot.
  void reclaimStuckSyncingItems(0).then(() => {
    const { branchId, terminalId } = getCtx();
    if (branchId && terminalId && isOnline()) void runSync({ branchId, terminalId });
  });

  subscribeConnectivity((online) => {
    if (online) {
      const { branchId, terminalId } = getCtx();
      if (branchId && terminalId) void runSync({ branchId, terminalId });
    }
    void emitStatus();
  });

  // Periodic sweep (in case the connectivity event missed). Also reclaims
  // items stuck in SYNCING so the pending badge can never stay high.
  if (typeof window !== "undefined") {
    window.setInterval(() => {
      const { branchId, terminalId } = getCtx();
      if (!isOnline()) return;
      if (branchId && terminalId) void runSync({ branchId, terminalId });
      else void reclaimStuckSyncingItems();
    }, 30_000);
  }

}