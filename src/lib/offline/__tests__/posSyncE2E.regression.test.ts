import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * End-to-end regression suite for the offline POS sync pipeline.
 *
 * Covers the failure modes that historically dropped cashier sales:
 *   1. Sales recorded while the terminal is offline (queue accumulation).
 *   2. CORS / "Failed to fetch" edge-function failures (the pos-sync
 *      module-scope corsHeaders regression) — every item must survive.
 *   3. Retry/backoff behaviour, including retry-budget exhaustion which
 *      must park items in the DLQ rather than silently deleting them.
 *   4. Idempotency replay — a re-sent batch must reuse the original keys
 *      and the simulated server must apply each key exactly once.
 *   5. Poisoned (validation-rejected) events must not block siblings.
 *   6. Items belonging to another branch must never leave the device
 *      under the active branch's auth context.
 *
 * Invariant asserted everywhere: sum(server applied) + sum(parked in DLQ)
 * === sum(sales recorded). No sale is ever lost.
 */

// ---------------------------------------------------------------------
// Fake IndexedDB
// ---------------------------------------------------------------------
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

let online = true;
vi.mock("../connectivity", () => ({
  isOnline: () => online,
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

const dlqReports: Array<{ key: string; message: string }> = [];
vi.mock("../dlq", () => ({
  reportFailedSyncItem: vi.fn(async (qi: any, _rec: any, msg: string) => {
    dlqReports.push({ key: qi.idempotency_key, message: msg });
  }),
}));

let batchingEnabled = true;
vi.mock("@/hooks/useFeatureFlags", () => ({
  isFeatureFlagEnabled: () => batchingEnabled,
}));

const postSyncBatch = vi.fn();
vi.mock("../api", () => ({
  postSyncBatch: (...args: unknown[]) => postSyncBatch(...args),
}));

// ---------------------------------------------------------------------
// Simulated pos-sync server with real idempotency semantics
// ---------------------------------------------------------------------
interface ServerOpts {
  /** Throw before applying anything (network/CORS class failure). */
  throwWith?: () => Error | null;
  /** Per-item hard rejection. */
  rejectKey?: (key: string) => string | null;
}

function makeServer(opts: ServerOpts = {}) {
  const applied = new Map<string, string>(); // idempotency_key -> server_id
  const seen: string[] = [];
  let seq = 0;

  const handler = async ({ items }: { items: Array<{ idempotency_key: string }> }) => {
    const err = opts.throwWith?.();
    if (err) throw err;
    return items.map((i) => {
      seen.push(i.idempotency_key);
      const reject = opts.rejectKey?.(i.idempotency_key) ?? null;
      if (reject) {
        return { idempotency_key: i.idempotency_key, status: "failed", error: reject, entity_type: "ORDER" };
      }
      if (applied.has(i.idempotency_key)) {
        // Replay of an already-applied event -> duplicate, NOT a second write.
        return {
          idempotency_key: i.idempotency_key,
          status: "duplicate",
          server_id: applied.get(i.idempotency_key)!,
          entity_type: "ORDER",
        };
      }
      const serverId = `srv-${++seq}`;
      applied.set(i.idempotency_key, serverId);
      return { idempotency_key: i.idempotency_key, status: "ok", server_id: serverId, entity_type: "ORDER" };
    });
  };

  return { applied, seen, handler };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function recordSale(localId: string, branchId = "branch-A") {
  tables.orders.set(localId, {
    local_id: localId,
    server_id: null,
    branch_id: branchId,
    cashier_id: "cashier-1",
    terminal_id: "term-1",
    business_date: "2026-08-13",
    payload: { receipt_number: localId, total: 100 },
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
  return `idem-${localId}`;
}

function recordSales(n: number, prefix = "S", branchId = "branch-A") {
  return Array.from({ length: n }, (_, i) => recordSale(`${prefix}${i + 1}`, branchId));
}

function sentKeys() {
  return postSyncBatch.mock.calls.flatMap((c: any[]) =>
    c[0].items.map((i: any) => i.idempotency_key as string),
  );
}

/** Jump past any scheduled backoff window (max policy cap is 15 minutes). */
function elapseBackoff() {
  vi.setSystemTime(new Date(Date.now() + 30 * 60_000));
}

const CTX = { branchId: "branch-A", terminalId: "term-1" };

async function drain(maxRuns = 30) {
  const { runSync } = await import("../syncEngine");
  for (let i = 0; i < maxRuns; i++) {
    const pending = Array.from(tables.sync_queue.values()).filter((q) => q.status === "PENDING");
    if (pending.length === 0) break;
    await runSync(CTX);
    elapseBackoff();
  }
}

beforeEach(() => {
  Object.values(tables).forEach((t) => t.clear());
  dlqReports.length = 0;
  postSyncBatch.mockReset();
  online = true;
  batchingEnabled = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T20:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// =====================================================================

describe("offline terminal sale queue", () => {
  it("holds every sale while offline and never hits the wire", async () => {
    recordSales(12);
    online = false;

    const { runSync } = await import("../syncEngine");
    await runSync(CTX);

    expect(postSyncBatch).not.toHaveBeenCalled();
    expect(tables.sync_queue.size).toBe(12);
    expect(Array.from(tables.orders.values()).every((o) => o.status === "PENDING")).toBe(true);
  });

  it("drains a large backlog across multiple batches with exactly-once application", async () => {
    const keys = recordSales(60); // > MAX_BATCH_SIZE (25) => 3 chunks
    online = false;
    const { runSync } = await import("../syncEngine");
    await runSync(CTX);
    expect(postSyncBatch).not.toHaveBeenCalled();

    // Terminal comes back online.
    online = true;
    const server = makeServer();
    postSyncBatch.mockImplementation(server.handler);
    await drain();

    expect(postSyncBatch).toHaveBeenCalledTimes(3);
    expect(postSyncBatch.mock.calls.every((c: any[]) => c[0].items.length <= 25)).toBe(true);
    expect(server.applied.size).toBe(60);
    expect(new Set(server.seen).size).toBe(60);
    expect(new Set(keys)).toEqual(new Set(server.applied.keys()));

    expect(tables.sync_queue.size).toBe(0);
    expect(tables.failed.size).toBe(0);
    const orders = Array.from(tables.orders.values());
    expect(orders).toHaveLength(60);
    expect(orders.every((o) => o.status === "SYNCED" && o.server_id)).toBe(true);
  });
});

describe("CORS / edge-function failures", () => {
  // The pos-sync outage manifested client-side as an opaque TypeError.
  const corsFailures = [
    "TypeError: Failed to fetch",
    "pos-sync HTTP 500: ReferenceError: corsHeaders is not defined",
    "Access to fetch has been blocked by CORS policy",
  ];

  for (const message of corsFailures) {
    it(`retains and replays every sale after: ${message}`, async () => {
      const keys = recordSales(8);
      let failing = true;
      const server = makeServer({ throwWith: () => (failing ? new Error(message) : null) });
      postSyncBatch.mockImplementation(server.handler);

      const { runSync } = await import("../syncEngine");
      await runSync(CTX);

      // Nothing applied, nothing lost, all retryable.
      expect(server.applied.size).toBe(0);
      expect(tables.sync_queue.size).toBe(8);
      const queued = Array.from(tables.sync_queue.values());
      expect(queued.every((q) => q.status === "PENDING")).toBe(true);
      expect(queued.every((q) => q.retry_count === 1)).toBe(true);
      expect(queued.every((q) => !!q.next_retry_at)).toBe(true);
      expect(tables.failed.size).toBe(0);
      expect(dlqReports).toHaveLength(0);

      // Edge function is fixed/redeployed -> queue drains automatically.
      failing = false;
      elapseBackoff();
      await drain();

      expect(server.applied.size).toBe(8);
      expect(new Set(keys)).toEqual(new Set(server.applied.keys()));
      expect(tables.sync_queue.size).toBe(0);
      expect(Array.from(tables.orders.values()).every((o) => o.status === "SYNCED")).toBe(true);
    });
  }

  it("classifies CORS/network failures as retryable and does not burn the validation path", async () => {
    const { categorizeQueueError } = await import("../errorCategorization");
    for (const message of corsFailures.concat(["NetworkError when attempting to fetch resource"])) {
      const cat = categorizeQueueError({
        status: "PENDING",
        error_message: message,
      } as any);
      expect(cat.retryable).toBe(true);
      expect(["network", "server", "unknown"]).toContain(cat.id);
    }
  });
});

describe("retries and backoff", () => {
  it("respects the backoff window before re-sending", async () => {
    recordSales(3);
    const server = makeServer({ throwWith: () => new Error("Failed to fetch") });
    postSyncBatch.mockImplementation(server.handler);

    const { runSync } = await import("../syncEngine");
    await runSync(CTX);
    expect(postSyncBatch).toHaveBeenCalledTimes(1);

    // Immediate re-run: all items are still inside their backoff window.
    await runSync(CTX);
    expect(postSyncBatch).toHaveBeenCalledTimes(1);

    elapseBackoff();
    await runSync(CTX);
    expect(postSyncBatch).toHaveBeenCalledTimes(2);
    expect(tables.sync_queue.size).toBe(3);
  });

  it("parks items in the DLQ (never deletes them) when the retry budget is exhausted", async () => {
    const keys = recordSales(2);
    const server = makeServer({ rejectKey: () => "500 internal server error" });
    postSyncBatch.mockImplementation(server.handler);

    const { runSync } = await import("../syncEngine");
    for (let i = 0; i < 12; i++) {
      await runSync(CTX);
      elapseBackoff();
    }

    const queued = Array.from(tables.sync_queue.values());
    expect(queued).toHaveLength(2);
    expect(queued.every((q) => q.status === "FAILED")).toBe(true);
    // Surfaced server-side so ops can see them on the sync health dashboard.
    expect(new Set(dlqReports.map((d) => d.key))).toEqual(new Set(keys));
    expect(tables.failed.size).toBe(2);
    // Still recoverable from the Sync Center.
    expect(Array.from(tables.orders.values()).every((o) => o.status === "FAILED")).toBe(true);
  });

  it("recovers parked items via retryAllFailed once the server is healthy", async () => {
    const keys = recordSales(2);
    let broken = true;
    const server = makeServer({ rejectKey: () => (broken ? "503 gateway timeout" : null) });
    postSyncBatch.mockImplementation(server.handler);

    const { runSync, retryAllFailed } = await import("../syncEngine");
    for (let i = 0; i < 12; i++) {
      await runSync(CTX);
      elapseBackoff();
    }
    expect(Array.from(tables.sync_queue.values()).every((q) => q.status === "FAILED")).toBe(true);

    broken = false;
    await retryAllFailed();
    await drain();

    expect(server.applied.size).toBe(2);
    expect(new Set(keys)).toEqual(new Set(server.applied.keys()));
    expect(tables.sync_queue.size).toBe(0);
    expect(Array.from(tables.orders.values()).every((o) => o.status === "SYNCED")).toBe(true);
  });
});

describe("idempotency replay", () => {
  it("re-sends the original keys after a mid-batch abort and applies each sale once", async () => {
    batchingEnabled = false; // one item per HTTP call -> partial application
    const keys = recordSales(4);

    let calls = 0;
    const server = makeServer({
      // First chunk lands, the second call dies before responding.
      throwWith: () => (++calls === 2 ? new Error("Failed to fetch") : null),
    });
    postSyncBatch.mockImplementation(async (args: any) => {
      // Simulate the server applying the write even though the response is lost.
      const res = await server.handler(args);
      if (calls === 2) throw new Error("connection reset after write");
      return res;
    });

    const { runSync } = await import("../syncEngine");
    await runSync(CTX);
    elapseBackoff();

    // Server healthy again; the aborted item replays with the SAME key.
    postSyncBatch.mockImplementation(server.handler);
    await drain();

    // Exactly-once: 4 sales, 4 server rows, regardless of replays.
    expect(server.applied.size).toBe(4);
    expect(new Set(sentKeys())).toEqual(new Set(keys));
    expect(sentKeys().length).toBeGreaterThan(4); // replays did happen
    expect(new Set(server.seen).size).toBe(4);
    expect(tables.sync_queue.size).toBe(0);
    expect(tables.failed.size).toBe(0);
    expect(Array.from(tables.orders.values()).every((o) => o.status === "SYNCED")).toBe(true);
  });

  it("treats a pure duplicate response as success without minting a new key", async () => {
    const key = recordSales(1)[0];
    const server = makeServer();
    // Pre-apply server-side: the original ack was lost on the wire.
    server.applied.set(key, "srv-preexisting");
    postSyncBatch.mockImplementation(server.handler);

    await drain();

    expect(sentKeys()).toEqual([key]);
    expect(server.applied.size).toBe(1);
    const order = Array.from(tables.orders.values())[0];
    expect(order.status).toBe("SYNCED");
    expect(order.server_id).toBe("srv-preexisting");
    expect(tables.sync_queue.size).toBe(0);
  });

  it("is a no-op when re-run after a fully drained queue", async () => {
    recordSales(5);
    const server = makeServer();
    postSyncBatch.mockImplementation(server.handler);
    await drain();
    const callsAfterDrain = postSyncBatch.mock.calls.length;

    const { runSync } = await import("../syncEngine");
    elapseBackoff();
    await runSync(CTX);

    expect(postSyncBatch.mock.calls.length).toBe(callsAfterDrain);
    expect(server.applied.size).toBe(5);
  });
});

describe("poisoned events and tenant isolation", () => {
  it("quarantines a validation-rejected sale without blocking its siblings", async () => {
    const keys = recordSales(5);
    const poisoned = keys[2];
    const server = makeServer({
      rejectKey: (k) => (k === poisoned ? "validation: menu_item_id missing" : null),
    });
    postSyncBatch.mockImplementation(server.handler);

    await drain();

    expect(server.applied.size).toBe(4);
    const remaining = Array.from(tables.sync_queue.values());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].idempotency_key).toBe(poisoned);
    expect(remaining[0].status).toBe("FAILED_VALIDATION");
    expect(remaining[0].next_retry_at).toBeNull();
    expect(dlqReports.map((d) => d.key)).toEqual([poisoned]);

    // Nothing lost: applied + quarantined === recorded.
    expect(server.applied.size + remaining.length).toBe(5);
  });

  it("never sends another branch's queued sales under the active branch context", async () => {
    const mine = recordSales(3, "A");
    const theirs = recordSales(2, "B", "branch-B");
    const server = makeServer();
    postSyncBatch.mockImplementation(server.handler);

    await drain();

    expect(new Set(sentKeys())).toEqual(new Set(mine));
    for (const k of theirs) expect(server.applied.has(k)).toBe(false);
    // Their items are retained on-device, untouched.
    expect(tables.sync_queue.size).toBe(2);
    expect(Array.from(tables.sync_queue.values()).every((q) => q.status === "PENDING")).toBe(true);
  });
});