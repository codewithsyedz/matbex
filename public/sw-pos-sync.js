// =====================================================================
// Background Sync Service Worker for offline POS
// ---------------------------------------------------------------------
// Drains the IndexedDB sync_queue by POSTing batches to the
// pos-sync Supabase Edge Function - even when the POS tab is closed.
//
// Scope of intentional behavior:
//   - DOES NOT intercept any `fetch` events (no caching, no offline shell).
//     This is critical: Lovable previews break if a SW caches HTML.
//   - Listens for the Background Sync API event ("sync"  tag = "pos-sync")
//     and Periodic Background Sync ("periodicsync" tag = "pos-sync-periodic").
//   - Also listens for postMessage({type:"pos-sync-now"}) so the page can
//     trigger a drain on demand (used as a fallback on browsers without
//     Background Sync, e.g. Safari).
//
// Storage contract (must match src/lib/offline/db.ts):
//   DB:    matbex_pos_offline (legacy name: sufra_pos_offline) (v1)
//   Keys:  kv["pos.auth_token"]      = { access_token, refreshed_at }
//          kv["pos.terminal_id"]     = string
//          kv["pos.branch_id"]       = string
//          kv["pos.supabase_url"]    = string
//          kv["pos.supabase_anon"]   = string
//          kv["pos.aes_key.v1"]      = JsonWebKey
//
// This worker is safe to run repeatedly: every batch item carries an
// idempotency_key (terminal:entity:local_id) and the server de-duplicates.
// =====================================================================

const DB_NAME = "sufra_pos_offline";
const DB_VERSION = 1;
const STORES = {
  orders: "offline_orders",
  payments: "offline_payments",
  invoices: "offline_invoices",
  returns: "offline_returns",
  cashDrawer: "offline_cash_drawer_events",
  queue: "sync_queue",
  failed: "failed_sync_items",
  kv: "kv",
};
const ENC_PREFIX = "enc:v1:";
const SENSITIVE_FIELDS = new Set([
  "customer_phone",
  "customer_email",
  "phone",
  "email",
  "notes",
  "customer_notes",
]);
const MAX_RETRIES = 6;
const BASE_BACKOFF_MS = 4000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

// ---------- Lifecycle ----------------------------------------------------
self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// IMPORTANT: no fetch handler. We never want to cache navigations.

// ---------- Background Sync triggers ------------------------------------
self.addEventListener("sync", (event) => {
  if (event.tag === "pos-sync") {
    event.waitUntil(drainQueueSafely("background-sync"));
  }
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "pos-sync-periodic") {
    event.waitUntil(drainQueueSafely("periodic-sync"));
  }
});

// Page-driven trigger (Safari + manual "retry now").
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "pos-sync-now") {
    event.waitUntil(
      drainQueueSafely("message").then((res) => {
        try {
          event.source && event.source.postMessage({ type: "pos-sync-result", ...res });
        } catch (_) {}
      }),
    );
  }
});

// ---------- IndexedDB helpers (no idb dep) ------------------------------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Do NOT define onupgradeneeded here; the page owns the schema.
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IDB blocked"));
  });
}
function txAll(db, store) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const r = t.objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
function txGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const r = t.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function txPut(db, store, value) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const r = t.objectStore(store).put(value);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
function txDel(db, store, key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const r = t.objectStore(store).delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
async function kv(db, key) {
  const row = await txGet(db, STORES.kv, key);
  return row ? row.value : undefined;
}

// ---------- Crypto (mirror of src/lib/offline/crypto.ts) ----------------
function b64decode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function importKey(jwk) {
  return crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, false, ["decrypt"]);
}
async function decryptString(token, key) {
  if (typeof token !== "string" || !token.startsWith(ENC_PREFIX)) return token;
  const merged = b64decode(token.slice(ENC_PREFIX.length));
  const iv = merged.slice(0, 12);
  const ct = merged.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plain);
}
async function unprotect(value, key) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) out.push(await unprotect(v, key));
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && SENSITIVE_FIELDS.has(k)) {
      out[k] = await decryptString(v, key);
    } else if (v && typeof v === "object") {
      out[k] = await unprotect(v, key);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------- Queue drain --------------------------------------------------
function entityStore(t) {
  switch (t) {
    case "ORDER": return STORES.orders;
    case "PAYMENT": return STORES.payments;
    case "INVOICE": return STORES.invoices;
    case "CASH_DRAWER": return STORES.cashDrawer;
    case "RETURN": return STORES.returns;
    default: return null;
  }
}
function backoffMs(retry) {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, retry), MAX_BACKOFF_MS);
}
function isValidationError(msg) {
  return /validation|invalid|missing|forbidden|409|422/i.test(String(msg || ""));
}

async function drainQueueSafely(trigger) {
  try {
    const result = await drainQueue();
    return { ok: true, trigger, ...result };
  } catch (err) {
    // Throw so Background Sync API knows to retry (when applicable).
    return { ok: false, trigger, error: String(err && err.message || err) };
  }
}

async function drainQueue() {
  const db = await openDB();

  const [token, terminalId, branchId, supabaseUrl, anonKey, jwk] = await Promise.all([
    kv(db, "pos.auth_token"),
    kv(db, "pos.terminal_id"),
    kv(db, "pos.branch_id"),
    kv(db, "pos.supabase_url"),
    kv(db, "pos.supabase_anon"),
    kv(db, "pos.aes_key.v1"),
  ]);

  if (!token || !token.access_token || !terminalId || !branchId || !supabaseUrl || !anonKey) {
    return { skipped: "missing-credentials" };
  }

  const cryptoKey = jwk ? await importKey(jwk).catch(() => null) : null;

  const queue = (await txAll(db, STORES.queue))
    .filter((q) => q.status === "PENDING" || q.status === "FAILED")
    .sort((a, b) => {
      const order = { ORDER: 0, PAYMENT: 1, INVOICE: 2, CASH_DRAWER: 3, RETURN: 4 };
      return (order[a.entity_type] ?? 9) - (order[b.entity_type] ?? 9);
    });

  const now = Date.now();
  // Cap the batch: oversized uploads exceed the edge function's wall-clock
  // budget and fail at the gateway (502/520), stranding the whole queue.
  const SW_MAX_BATCH = 25;
  const due = queue
    .filter((q) => !q.next_retry_at || new Date(q.next_retry_at).getTime() <= now)
    .slice(0, SW_MAX_BATCH);
  if (due.length === 0) return { drained: 0 };

  // Build batch
  const batch = [];
  const recIndex = new Map();
  for (const qi of due) {
    const store = entityStore(qi.entity_type);
    if (!store) continue;
    const all = await txAll(db, store);
    const rec = all.find((r) => r.local_id === qi.entity_local_id);
    if (!rec) {
      await txDel(db, STORES.queue, qi.queue_id);
      continue;
    }
    const payload = cryptoKey ? await unprotect(rec.payload, cryptoKey) : rec.payload;
    qi.status = "SYNCING";
    qi.last_attempt_at = new Date().toISOString();
    await txPut(db, STORES.queue, qi);
    recIndex.set(qi.queue_id, { rec, store });
    batch.push({
      idempotency_key: qi.idempotency_key,
      entity_type: qi.entity_type,
      operation: qi.operation,
      payload,
      dependency_key: qi.dependency_key || null,
    });
  }
  if (batch.length === 0) return { drained: 0 };

  const requestId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  let results;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/pos-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.access_token}`,
        apikey: anonKey,
        "X-Terminal-Id": terminalId,
        "X-Branch-Id": branchId,
        "X-Request-Id": requestId,
        "Idempotency-Key": batch[0].idempotency_key,
      },
      body: JSON.stringify({ items: batch }),
    });
    if (!res.ok) throw new Error(`pos-sync HTTP ${res.status}`);
    const json = await res.json();
    results = json.results || [];
  } catch (err) {
    // Network/server failure: mark with backoff so the foreground engine
    // (or the next sync trigger) tries again.
    for (const qi of due) {
      qi.status = "PENDING";
      qi.retry_count = (qi.retry_count || 0) + 1;
      qi.error_message = String(err && err.message || err);
      qi.next_retry_at = new Date(Date.now() + backoffMs(qi.retry_count)).toISOString();
      if (qi.retry_count >= MAX_RETRIES) qi.status = "FAILED";
      await txPut(db, STORES.queue, qi);
    }
    // Re-throw so Background Sync API will retry this tag later.
    throw err;
  }

  const byKey = new Map(results.map((r) => [r.idempotency_key, r]));
  let synced = 0;
  let failed = 0;
  for (const qi of due) {
    const r = byKey.get(qi.idempotency_key);
    const ent = recIndex.get(qi.queue_id);
    if (!r) {
      // Server returned partial results (time budget hit) — release the item
      // back to PENDING so the next drain picks it up instead of leaving it
      // stuck in SYNCING.
      qi.status = "PENDING";
      await txPut(db, STORES.queue, qi);
      continue;
    }
    if (!ent) continue;
    if (r.status === "ok" || r.status === "duplicate") {
      ent.rec.server_id = r.server_id || ent.rec.server_id;
      ent.rec.status = "SYNCED";
      ent.rec.synced_at = new Date().toISOString();
      ent.rec.updated_at = ent.rec.synced_at;
      ent.rec.error_message = null;
      await txPut(db, ent.store, ent.rec);
      await txDel(db, STORES.queue, qi.queue_id);
      synced++;
    } else {
      const msg = r.error || "unknown server error";
      qi.error_message = msg;
      qi.retry_count = (qi.retry_count || 0) + 1;
      if (isValidationError(msg)) {
        qi.status = "FAILED_VALIDATION";
        await txPut(db, STORES.failed, qi);
      } else if (qi.retry_count >= MAX_RETRIES) {
        qi.status = "FAILED";
        await txPut(db, STORES.failed, qi);
      } else {
        qi.status = "PENDING";
        qi.next_retry_at = new Date(Date.now() + backoffMs(qi.retry_count)).toISOString();
      }
      await txPut(db, STORES.queue, qi);
      ent.rec.status = qi.status;
      ent.rec.error_message = msg;
      ent.rec.updated_at = new Date().toISOString();
      await txPut(db, ent.store, ent.rec);
      failed++;
    }
  }

  // Notify any open clients so the badge / Sync Center refreshes.
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clientsList) {
    try { c.postMessage({ type: "pos-sync-drained", synced, failed }); } catch (_) {}
  }

  return { drained: due.length, synced, failed };
}
