import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Epic E3 — Chaos test.
 *
 * Simulates a mid-batch abort: with chunk size = 1, the first chunk succeeds
 * server-side but the second throws (e.g. network dies). The whole `due`
 * batch is rolled back to PENDING and retried on the next runSync. Because
 * chunk 1's write already landed, the retry receives `duplicate` for that
 * idempotency key and `ok` for the rest.
 *
 * Assertions:
 *   - Every queued item ultimately reaches SYNCED (no gaps).
 *   - No duplicate idempotency key is ever sent under two DIFFERENT keys
 *     (i.e. the client resumes with the same key it originally minted).
 *   - The queue drains completely; no leaked FAILED rows.
 */

const tables: Record<string, Map<string, any>> = {
  sync_queue: new Map(),
  orders: new Map(),
  payments: new Map(),
  invoices: new Map(),
  cash_drawer: new Map(),
  returns: new Map(),
  failed: new Map(),
  kv: new Map(),
};
const STORES = {
  queue: "sync_queue",
  orders: "orders",
  payments: "payments",
  invoices: "invoices",
  cashDrawer: "cash_drawer",
  returns: "returns",
  failed: "failed",
};

vi.mock("../db", () => ({
  STORES,
  getAll: vi.fn(async (store: string) => Array.from(tables[store].values())),
  put: vi.fn(async (store: string, row: any) => {
    const key = row.queue_id ?? row.local_id ?? row.id ?? crypto.randomUUID();
    tables[store].set(key, row);
  }),
  remove: vi.fn(async (store: string, key: string) => {
    tables[store].delete(key);
  }),
  kvSet: vi.fn(async (k: string, v: unknown) => tables.kv.set(k, v)),
  kvGet: vi.fn(async (k: string) => tables.kv.get(k) ?? null),
}));

vi.mock("../connectivity", () => ({
  isOnline: () => true,
  subscribeConnectivity: () => () => {},
}));

vi.mock("../crypto", () => ({
  unprotectPayload: vi.fn(async (p: unknown) => p),
  protectPayload: vi.fn(async (p: unknown) => p),
}));

vi.mock("../metrics", () => ({
  recordBatchSuccess: vi.fn(),
  recordBatchFailure: vi.fn(),
  refreshQueueDepth: vi.fn(),
}));

vi.mock("../dlq", () => ({
  reportFailedSyncItem: vi.fn(),
}));

// Force chunk size = 1 so each order is its own chunk.
vi.mock("@/hooks/useFeatureFlags", () => ({
  isFeatureFlagEnabled: () => false,
}));

const postSyncBatch = vi.fn();
vi.mock("../api", () => ({
  postSyncBatch: (...args: unknown[]) => postSyncBatch(...args),
}));

function seedOrder(localId: string) {
  tables.orders.set(localId, {
    local_id: localId,
    server_id: null,
    branch_id: "branch-A",
    cashier_id: "u1",
    terminal_id: "t1",
    business_date: "2026-05-06",
    payload: { receipt_number: localId },
    status: "PENDING",
    retry_count: 0,
    error_message: null,
    created_at: new Date(Date.now() + localId.length).toISOString(),
    updated_at: new Date().toISOString(),
    synced_at: null,
  });
  const queueId = `q-${localId}`;
  tables.sync_queue.set(queueId, {
    queue_id: queueId,
    entity_type: "ORDER",
    entity_local_id: localId,
    operation: "CREATE",
    idempotency_key: `idem-${localId}`,
    dependency_key: null,
    status: "PENDING",
    retry_count: 0,
    last_attempt_at: null,
    next_retry_at: null,
    error_message: null,
    created_at: new Date().toISOString(),
  });
  return `idem-${localId}`;
}

function clearBackoff() {
  for (const qi of tables.sync_queue.values()) qi.next_retry_at = null;
}

describe("runSync — chaos: mid-batch abort resumes without duplicates or gaps", () => {
  beforeEach(() => {
    Object.values(tables).forEach((t) => t.clear());
    postSyncBatch.mockReset();
  });

  it("resumes from the failed chunk with the same idempotency keys", async () => {
    const keyA = seedOrder("A");
    const keyB = seedOrder("B");
    const keyC = seedOrder("C");

    // First run: chunk 1 (A) ok, chunk 2 (B) THROWS mid-batch.
    // engine collects chunk 1's result but rolls back everything on throw.
    postSyncBatch
      .mockResolvedValueOnce([{ idempotency_key: keyA, status: "ok", server_id: "srv-A", entity_type: "ORDER" }])
      .mockRejectedValueOnce(new Error("network down mid-batch"));

    const { runSync } = await import("../syncEngine");
    await runSync({ branchId: "branch-A", terminalId: "t1" });

    // 2 chunks were attempted before the abort.
    expect(postSyncBatch).toHaveBeenCalledTimes(2);
    // All items rolled back to PENDING (not FAILED — retry budget not spent).
    for (const qi of tables.sync_queue.values()) {
      expect(qi.status).toBe("PENDING");
    }
    // Simulate backoff window elapsing so the next runSync will pick them up.
    clearBackoff();

    // Second run: server treats A as duplicate (already applied), B & C ok.
    // The engine must resubmit with the SAME idempotency keys — otherwise
    // A would be double-written server-side.
    postSyncBatch
      .mockResolvedValueOnce([{ idempotency_key: keyA, status: "duplicate", server_id: "srv-A", entity_type: "ORDER" }])
      .mockResolvedValueOnce([{ idempotency_key: keyB, status: "ok", server_id: "srv-B", entity_type: "ORDER" }])
      .mockResolvedValueOnce([{ idempotency_key: keyC, status: "ok", server_id: "srv-C", entity_type: "ORDER" }]);

    await runSync({ branchId: "branch-A", terminalId: "t1" });

    // Total calls: 2 (first run) + 3 (retry) = 5.
    expect(postSyncBatch).toHaveBeenCalledTimes(5);

    // Verify every payload the client ever sent used one of the original keys
    // — no new key was minted for a retry (no gaps, no doubles server-side).
    const sentKeys = postSyncBatch.mock.calls.flatMap((c: any[]) =>
      c[0].items.map((i: any) => i.idempotency_key),
    );
    const uniqueSent = new Set(sentKeys);
    expect(uniqueSent).toEqual(new Set([keyA, keyB, keyC]));
    // A + B were both attempted in the first run; C only reached the wire on resume.
    expect(sentKeys.filter((k: string) => k === keyA).length).toBe(2);
    expect(sentKeys.filter((k: string) => k === keyB).length).toBe(2);
    expect(sentKeys.filter((k: string) => k === keyC).length).toBe(1);

    // Queue fully drained. No leaked FAILED rows.
    expect(tables.sync_queue.size).toBe(0);
    expect(tables.failed.size).toBe(0);

    // All three orders end SYNCED with their server ids assigned.
    const orders = Array.from(tables.orders.values());
    expect(orders).toHaveLength(3);
    for (const o of orders) {
      expect(o.status).toBe("SYNCED");
      expect(o.server_id).toMatch(/^srv-/);
      expect(o.synced_at).toBeTruthy();
    }
  });

  it("does not lose items when the abort happens on the very first chunk", async () => {
    const keyA = seedOrder("A");
    const keyB = seedOrder("B");

    postSyncBatch
      .mockRejectedValueOnce(new Error("connection reset")) // first chunk dies
      .mockResolvedValueOnce([{ idempotency_key: keyA, status: "ok", server_id: "srv-A", entity_type: "ORDER" }])
      .mockResolvedValueOnce([{ idempotency_key: keyB, status: "ok", server_id: "srv-B", entity_type: "ORDER" }]);

    const { runSync } = await import("../syncEngine");
    await runSync({ branchId: "branch-A", terminalId: "t1" });
    clearBackoff();
    await runSync({ branchId: "branch-A", terminalId: "t1" });

    expect(tables.sync_queue.size).toBe(0);
    expect(tables.failed.size).toBe(0);
    const orders = Array.from(tables.orders.values());
    expect(orders.map((o) => o.status).sort()).toEqual(["SYNCED", "SYNCED"]);
  });
});