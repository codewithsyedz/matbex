// =====================================================================
// Epic D1 — Client-side sync metrics collector.
// ---------------------------------------------------------------------
// Tracks per-device counters and latency samples for the offline sync
// engine. Persisted in the IDB `kv` store so a page reload preserves
// history; consumed by the /admin/sync-health dashboard for the
// "This device" panel and by dev-console debugging.
// =====================================================================

import { getAll, kvGet, kvSet, STORES } from "./db";
import type { SyncQueueItem } from "./types";

const KV_KEY = "pos.sync_metrics.v1";
const MAX_LATENCY_SAMPLES = 200;

export interface SyncMetricsSnapshot {
  queue_depth: number;
  failed_depth: number;
  sync_success: number;
  sync_failed: number;
  batches_sent: number;
  latency_ms_samples: number[];
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  updated_at: string;
}

function empty(): SyncMetricsSnapshot {
  return {
    queue_depth: 0,
    failed_depth: 0,
    sync_success: 0,
    sync_failed: 0,
    batches_sent: 0,
    latency_ms_samples: [],
    last_success_at: null,
    last_failure_at: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  };
}

async function load(): Promise<SyncMetricsSnapshot> {
  const raw = (await kvGet<SyncMetricsSnapshot>(KV_KEY)) as SyncMetricsSnapshot | undefined;
  return raw ?? empty();
}

async function save(next: SyncMetricsSnapshot) {
  next.updated_at = new Date().toISOString();
  await kvSet(KV_KEY, next);
}

/** Recompute queue/failed depths from IDB and persist. */
export async function refreshQueueDepth(): Promise<SyncMetricsSnapshot> {
  const queue = await getAll<SyncQueueItem>(STORES.queue);
  const snap = await load();
  snap.queue_depth = queue.filter((q) => q.status === "PENDING" || q.status === "SYNCING").length;
  snap.failed_depth = queue.filter((q) => q.status === "FAILED" || q.status === "FAILED_VALIDATION").length;
  await save(snap);
  return snap;
}

export async function recordBatchSuccess(count: number, latencyMs: number) {
  const snap = await load();
  snap.batches_sent += 1;
  snap.sync_success += count;
  snap.last_success_at = new Date().toISOString();
  snap.last_error = null;
  snap.latency_ms_samples.push(Math.max(0, Math.round(latencyMs)));
  if (snap.latency_ms_samples.length > MAX_LATENCY_SAMPLES) {
    snap.latency_ms_samples.splice(0, snap.latency_ms_samples.length - MAX_LATENCY_SAMPLES);
  }
  await save(snap);
}

export async function recordBatchFailure(count: number, latencyMs: number, error: string) {
  const snap = await load();
  snap.batches_sent += 1;
  snap.sync_failed += count;
  snap.last_failure_at = new Date().toISOString();
  snap.last_error = error.slice(0, 500);
  snap.latency_ms_samples.push(Math.max(0, Math.round(latencyMs)));
  if (snap.latency_ms_samples.length > MAX_LATENCY_SAMPLES) {
    snap.latency_ms_samples.splice(0, snap.latency_ms_samples.length - MAX_LATENCY_SAMPLES);
  }
  await save(snap);
}

export async function getMetricsSnapshot(): Promise<SyncMetricsSnapshot> {
  return refreshQueueDepth();
}

export async function resetMetrics() {
  await save(empty());
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export function summarizeLatency(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.length ? sorted[sorted.length - 1] : null,
  };
}