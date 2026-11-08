import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Verifies that `runSync` does NOT mix queued transactions across
 * tenants/branches. When the offline engine is currently bound to
 * branch A, queue items belonging to branch B must remain in IndexedDB
 * untouched and must NOT be sent to the server under A's auth context.
 */

// In-memory fake of the offline DB used by syncEngine.
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

// Connectivity is always online in this test.
vi.mock("../connectivity", () => ({
  isOnline: () => true,
  subscribeConnectivity: () => () => {},
}));

// Skip the real AES-GCM unwrap; payloads are stored plain in this test.
vi.mock("../crypto", () => ({
  unprotectPayload: vi.fn(async (p: unknown) => p),
  protectPayload: vi.fn(async (p: unknown) => p),
}));

const postSyncBatch = vi.fn();
vi.mock("../api", () => ({
  postSyncBatch: (...args: unknown[]) => postSyncBatch(...args),
}));

function makeOrder(branchId: string, localId: string) {
  tables.orders.set(localId, {
    local_id: localId,
    server_id: null,
    branch_id: branchId,
    cashier_id: "u1",
    terminal_id: "t1",
    business_date: "2026-05-06",
    payload: { receipt_number: localId, items: [] },
    status: "PENDING",
    retry_count: 0,
    error_message: null,
    created_at: new Date().toISOString(),
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
  return { queueId, idempotencyKey: `idem-${localId}` };
}

describe("runSync - cross-tenant queue isolation", () => {
  beforeEach(() => {
    Object.values(tables).forEach((t) => t.clear());
    postSyncBatch.mockReset();
  });

  it("only sends queue items belonging to the active branch", async () => {
    const a = makeOrder("branch-A", "order-A1");
    makeOrder("branch-B", "order-B1");

    postSyncBatch.mockResolvedValueOnce([
      { idempotency_key: a.idempotencyKey, status: "ok", server_id: "srv-A1" },
    ]);

    const { runSync } = await import("../syncEngine");
    await runSync({ branchId: "branch-A", terminalId: "t1" });

    expect(postSyncBatch).toHaveBeenCalledTimes(1);
    const sent = postSyncBatch.mock.calls[0][0];
    expect(sent.branchId).toBe("branch-A");
    const keys = sent.items.map((i: any) => i.idempotency_key);
    expect(keys).toEqual([a.idempotencyKey]);
    expect(keys).not.toContain("idem-order-B1");

    // Branch B's queue item is still pending.
    const remaining = Array.from(tables.sync_queue.values());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].entity_local_id).toBe("order-B1");
    expect(remaining[0].status).toBe("PENDING");
  });

  it("drops orphaned queue items (no matching record) but never touches other tenants", async () => {
    makeOrder("branch-B", "order-B1");
    // Orphan: queue entry with no record in any store.
    tables.sync_queue.set("q-orphan", {
      queue_id: "q-orphan",
      entity_type: "ORDER",
      entity_local_id: "missing",
      operation: "CREATE",
      idempotency_key: "idem-orphan",
      dependency_key: null,
      status: "PENDING",
      retry_count: 0,
      last_attempt_at: null,
      next_retry_at: null,
      error_message: null,
      created_at: new Date().toISOString(),
    });

    const { runSync } = await import("../syncEngine");
    await runSync({ branchId: "branch-A", terminalId: "t1" });

    // Nothing to send for branch A.
    expect(postSyncBatch).not.toHaveBeenCalled();
    // Orphan dropped, branch-B item preserved.
    const remaining = Array.from(tables.sync_queue.values()).map((q) => q.queue_id);
    expect(remaining).toContain("q-order-B1");
    expect(remaining).not.toContain("q-orphan");
  });

  it("after switching to branch B, the previously skipped item is sent under B's context", async () => {
    makeOrder("branch-A", "order-A1");
    const b = makeOrder("branch-B", "order-B1");

    postSyncBatch
      .mockResolvedValueOnce([
        { idempotency_key: "idem-order-A1", status: "ok", server_id: "srv-A1" },
      ])
      .mockResolvedValueOnce([
        { idempotency_key: b.idempotencyKey, status: "ok", server_id: "srv-B1" },
      ]);

    const { runSync } = await import("../syncEngine");
    await runSync({ branchId: "branch-A", terminalId: "t1" });
    await runSync({ branchId: "branch-B", terminalId: "t1" });

    expect(postSyncBatch).toHaveBeenCalledTimes(2);
    expect(postSyncBatch.mock.calls[0][0].branchId).toBe("branch-A");
    expect(postSyncBatch.mock.calls[1][0].branchId).toBe("branch-B");
    expect(postSyncBatch.mock.calls[1][0].items[0].idempotency_key).toBe(b.idempotencyKey);
  });
});