// =====================================================================
// API client for the pos-sync edge function.
// Adds Idempotency-Key, X-Terminal-Id, X-Branch-Id, X-Request-Id.
// =====================================================================

import { db } from "@/integrations/db/client";
import type { SyncQueueItem } from "./types";

export interface SyncBatchItem {
  idempotency_key: string;
  entity_type: SyncQueueItem["entity_type"];
  operation: SyncQueueItem["operation"];
  payload: Record<string, unknown>;
  dependency_key?: string | null;
}

export interface SyncResultItem {
  idempotency_key: string;
  status: "ok" | "duplicate" | "failed";
  server_id?: string | null;
  error?: string;
  entity_type: SyncQueueItem["entity_type"];
}

const API_URL = import.meta.env.VITE_API_URL as string;

/** Full request/response trace captured for DLQ forensics. */
export interface SyncTrace {
  batch_id: string;
  request_id: string;
  url: string;
  method: string;
  /** Auth/apikey values are never captured. */
  headers: Record<string, string>;
  item_count: number;
  idempotency_keys: string[];
  request_body_preview: unknown;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  http_status?: number | null;
  response_body?: unknown;
  error?: string | null;
}

/** Error thrown by postSyncBatch carrying the trace of the failed call. */
export class SyncBatchError extends Error {
  trace: SyncTrace;
  constructor(message: string, trace: SyncTrace) {
    super(message);
    this.name = "SyncBatchError";
    this.trace = trace;
  }
}

function truncate(v: unknown, max = 8000): unknown {
  try {
    const s = JSON.stringify(v);
    if (s.length <= max) return v;
    return { truncated: true, size: s.length, preview: s.slice(0, max) };
  } catch {
    return { unserializable: true };
  }
}

export function getHealthUrl(): string {
  // Re-uses the auth health endpoint (always 200 OK when project is reachable).
  return `${API_URL}/auth/v1/health`;
}

export function getHealthHeaders(): Record<string, string> {
  const apikey = import.meta.env.VITE_API_KEY as string;
  return apikey ? { apikey, Authorization: `Bearer ${apikey}` } : {};
}

export async function postSyncBatch(opts: {
  branchId: string;
  terminalId: string;
  items: SyncBatchItem[];
  /** Optional callback receiving the completed trace (success or failure). */
  onTrace?: (trace: SyncTrace) => void;
}): Promise<SyncResultItem[]> {
  const { data: sessionData } = await db.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const requestId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const startedAt = Date.now();
  const trace: SyncTrace = {
    batch_id: batchId,
    request_id: requestId,
    url: `${API_URL}/functions/v1/pos-sync`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Terminal-Id": opts.terminalId,
      "X-Branch-Id": opts.branchId,
      "X-Request-Id": requestId,
      "Idempotency-Key": opts.items[0]?.idempotency_key ?? requestId,
    },
    item_count: opts.items.length,
    idempotency_keys: opts.items.map((i) => i.idempotency_key),
    request_body_preview: truncate({ items: opts.items }),
    started_at: new Date(startedAt).toISOString(),
  };
  const finish = (extra: Partial<SyncTrace>) => {
    Object.assign(trace, extra, {
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    });
    opts.onTrace?.(trace);
    return trace;
  };

  let res: Response;
  try {
    res = await fetch(trace.url, {
      method: "POST",
      headers: {
        ...trace.headers,
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_API_KEY as string,
      },
      body: JSON.stringify({ items: opts.items }),
    });
  } catch (err) {
    // Network / CORS class failure — no HTTP response at all.
    const msg = (err as Error).message || "network error";
    throw new SyncBatchError(msg, finish({ http_status: null, error: msg }));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const msg = `pos-sync HTTP ${res.status}: ${text}`;
    throw new SyncBatchError(
      msg,
      finish({ http_status: res.status, response_body: truncate(text), error: msg }),
    );
  }
  const json = await res.json().catch(() => ({}));
  finish({ http_status: res.status, response_body: truncate(json), error: null });
  return (json.results ?? []) as SyncResultItem[];
}