// =====================================================================
// IndexedDB layer for offline POS
// ---------------------------------------------------------------------
// Stores:
//   offline_orders, offline_payments, offline_invoices,
//   offline_returns, offline_cash_drawer_events,
//   sync_queue, sync_logs, failed_sync_items, kv
//
// Versioned schema, hand-rolled (no idb dep) so the bundle stays light.
// All records share the OfflineRecord shape from ./types.
// =====================================================================

const DB_NAME = "matbex_pos_offline";
const DB_VERSION = 2;

export const STORES = {
  orders: "offline_orders",
  payments: "offline_payments",
  invoices: "offline_invoices",
  returns: "offline_returns",
  cashDrawer: "offline_cash_drawer_events",
  queue: "sync_queue",
  logs: "sync_logs",
  failed: "failed_sync_items",
  kv: "kv",
  cacheMenu: "cache_menu",
  cachePricing: "cache_pricing",
  cacheCustomers: "cache_customers",
  cacheReceiptTemplates: "cache_receipt_templates",
  cacheTaxConfig: "cache_tax_config",
  cacheZatcaConfig: "cache_zatca_config",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let _dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ensure = (name: string, opts?: IDBObjectStoreParameters) => {
        if (!db.objectStoreNames.contains(name)) {
          const s = db.createObjectStore(name, opts ?? { keyPath: "local_id" });
          if (name !== STORES.kv) {
            s.createIndex("status", "status", { unique: false });
            s.createIndex("created_at", "created_at", { unique: false });
          }
        }
      };
      ensure(STORES.orders);
      ensure(STORES.payments);
      ensure(STORES.invoices);
      ensure(STORES.returns);
      ensure(STORES.cashDrawer);
      ensure(STORES.queue, { keyPath: "queue_id" });
      ensure(STORES.logs, { keyPath: "id", autoIncrement: true });
      ensure(STORES.failed, { keyPath: "queue_id" });
      if (!db.objectStoreNames.contains(STORES.kv)) {
        db.createObjectStore(STORES.kv, { keyPath: "key" });
      }
      // Epic C — read-through caches for menu / pricing / customers /
      // receipt templates / tax + ZATCA config. Keyed by `id` (natural
      // primary key of the source row) with an updated_at index so the
      // hydrator can drop stale rows.
      const ensureCache = (name: string) => {
        if (!db.objectStoreNames.contains(name)) {
          const s = db.createObjectStore(name, { keyPath: "id" });
          s.createIndex("updated_at", "updated_at", { unique: false });
        }
      };
      ensureCache(STORES.cacheMenu);
      ensureCache(STORES.cachePricing);
      ensureCache(STORES.cacheCustomers);
      ensureCache(STORES.cacheReceiptTemplates);
      ensureCache(STORES.cacheTaxConfig);
      ensureCache(STORES.cacheZatcaConfig);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx<T>(
  store: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store as any, mode);
        let result: T;
        Promise.resolve(fn(t))
          .then((r) => {
            result = r;
          })
          .catch(reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  await tx(store, "readwrite", (t) => reqToPromise(t.objectStore(store).put(value as any)));
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return tx(store, "readonly", (t) => reqToPromise<T>(t.objectStore(store).get(key) as any));
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return tx(store, "readonly", (t) => reqToPromise<T[]>(t.objectStore(store).getAll() as any));
}

export async function getByStatus<T>(store: StoreName, status: string): Promise<T[]> {
  return tx(store, "readonly", (t) =>
    reqToPromise<T[]>(t.objectStore(store).index("status").getAll(IDBKeyRange.only(status)) as any),
  );
}

export async function remove(store: StoreName, key: IDBValidKey): Promise<void> {
  await tx(store, "readwrite", (t) => reqToPromise(t.objectStore(store).delete(key)));
}

export async function clearAll(): Promise<void> {
  await tx(
    Object.values(STORES) as StoreName[],
    "readwrite",
    (t) => Promise.all(Object.values(STORES).map((s) => reqToPromise(t.objectStore(s).clear()))) as any,
  );
}

// Simple KV helpers (terminal id, last sync time, etc.)
export async function kvGet<T = unknown>(key: string): Promise<T | undefined> {
  const row = await get<{ key: string; value: T }>(STORES.kv, key);
  return row?.value;
}
export async function kvSet<T = unknown>(key: string, value: T): Promise<void> {
  await put(STORES.kv, { key, value });
}