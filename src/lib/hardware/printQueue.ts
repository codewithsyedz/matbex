// =====================================================================
// IndexedDB-backed print queue
// ---------------------------------------------------------------------
// Persists print jobs across browser refreshes and offline periods.
// Jobs are processed FIFO; failures are retried with exponential backoff.
// The most recent successful job is retained for "Reprint last receipt".
// =====================================================================

import type { PrintJob, PrintJobStatus, PrintReceiptPayload, PrinterTransport } from "./types";

const DB_NAME = "matbex_pos_print_queue";
const DB_VERSION = 1;
const STORE_JOBS = "jobs";
const STORE_KV = "kv";
const KV_LAST_RECEIPT = "last_receipt";

let _db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_JOBS)) {
        const s = db.createObjectStore(STORE_JOBS, { keyPath: "id" });
        s.createIndex("status", "status");
        s.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode) {
  return db.transaction(store, mode).objectStore(store);
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid(): string {
  return `pj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function enqueueJob(input: {
  payload: PrintReceiptPayload;
  transport: PrinterTransport;
  printerId: string | null;
  status?: PrintJobStatus;
}): Promise<PrintJob> {
  const db = await open();
  const job: PrintJob = {
    id: uid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: input.status ?? "pending",
    transport: input.transport,
    printerId: input.printerId,
    payload: input.payload,
    attempts: 0,
  };
  await promisify(tx(db, STORE_JOBS, "readwrite").put(job));
  return job;
}

export async function listJobs(): Promise<PrintJob[]> {
  const db = await open();
  const all = await promisify<PrintJob[]>(tx(db, STORE_JOBS, "readonly").getAll());
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateJob(id: string, patch: Partial<PrintJob>): Promise<PrintJob | null> {
  const db = await open();
  const store = tx(db, STORE_JOBS, "readwrite");
  const existing = await promisify<PrintJob | undefined>(store.get(id));
  if (!existing) return null;
  const merged: PrintJob = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await promisify(store.put(merged));
  return merged;
}

export async function deleteJob(id: string): Promise<void> {
  const db = await open();
  await promisify(tx(db, STORE_JOBS, "readwrite").delete(id));
}

export async function clearDoneJobs(): Promise<void> {
  const db = await open();
  const store = tx(db, STORE_JOBS, "readwrite");
  const all = await promisify<PrintJob[]>(store.getAll());
  await Promise.all(all.filter((j) => j.status === "done").map((j) => promisify(store.delete(j.id))));
}

export async function nextPending(): Promise<PrintJob | null> {
  const all = await listJobs();
  const now = Date.now();
  return (
    all.find((j) => {
      if (j.status !== "pending" && j.status !== "queued-offline") return false;
      if (!j.retryAfter) return true;
      return new Date(j.retryAfter).getTime() <= now;
    }) ?? null
  );
}

export async function setLastReceipt(payload: PrintReceiptPayload): Promise<void> {
  const db = await open();
  await promisify(tx(db, STORE_KV, "readwrite").put({ key: KV_LAST_RECEIPT, value: payload }));
}

export async function getLastReceipt(): Promise<PrintReceiptPayload | null> {
  const db = await open();
  const row = await promisify<{ key: string; value: PrintReceiptPayload } | undefined>(
    tx(db, STORE_KV, "readonly").get(KV_LAST_RECEIPT),
  );
  return row?.value ?? null;
}