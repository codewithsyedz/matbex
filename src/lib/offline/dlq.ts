// =====================================================================
// Epic D3 — Dead-Letter Queue reporter
// ---------------------------------------------------------------------
// Inserts a row into public.failed_sync_items whenever the sync engine
// gives up on an offline event (permanent failure or retry cap hit).
// The DB trigger fans out in-app + WhatsApp alerts to tenant owners.
// Failures here are best-effort: never throw back into the sync loop.
// =====================================================================

import { db } from "@/integrations/db/client";
import type { OfflineRecord, SyncQueueItem } from "./types";
import type { SyncTrace } from "./api";

export interface LastAttemptMeta {
  attempted_at?: string;
  attempt_number?: number;
  http_status?: number | null;
  response_body?: unknown;
  retryable?: boolean;
  next_retry_at?: string | null;
  category?: string | null;
}

export interface DlqReportExtras {
  inputPayload?: unknown;
  validationErrors?: unknown;
  lastAttempt?: LastAttemptMeta;
  errorCategory?: string | null;
  /** Full request/response trace of the HTTP batch that failed. */
  trace?: SyncTrace | null;
  /** Retry budget for the item's error category. */
  maxRetries?: number | null;
  /** True when the item was parked because it blew through its retry budget. */
  retryExhausted?: boolean;
}

export async function reportFailedSyncItem(
  qi: SyncQueueItem,
  rec: OfflineRecord,
  errorMessage: string,
  extras: DlqReportExtras = {},
): Promise<void> {
  try {
    // rec.branch_id stores restaurant_id in this codebase (see types.ts §20).
    const restaurantId = rec.branch_id || null;
    let tenantId: string | null = null;
    let branchId: string | null = null;

    if (restaurantId) {
      const { data } = await db
        .from("restaurants")
        .select("tenant_id")
        .eq("id", restaurantId)
        .maybeSingle();
      tenantId = (data?.tenant_id as string | undefined) ?? null;

      const { data: primary } = await db
        .rpc("get_primary_branch_id", { _restaurant_id: restaurantId });
      if (typeof primary === "string") branchId = primary;
    }

    if (!tenantId) return; // cannot scope — skip silently

    const trace = extras.trace ?? null;

    const { data: inserted } = await (db as any).from("failed_sync_items").insert({
      tenant_id: tenantId,
      restaurant_id: restaurantId,
      branch_id: branchId,
      terminal_id: rec.terminal_id || null,
      event_type: qi.entity_type,
      event_id: qi.idempotency_key,
      payload: {
        queue_id: qi.queue_id,
        entity_local_id: qi.entity_local_id,
        operation: qi.operation,
        business_date: rec.business_date,
        cashier_id: rec.cashier_id,
      },
      input_payload: safeJson(extras.inputPayload ?? rec),
      validation_errors: extras.validationErrors ? safeJson(extras.validationErrors) : null,
      last_attempt: safeJson({
        attempted_at: new Date().toISOString(),
        attempt_number: qi.retry_count,
        http_status: null,
        retryable: qi.status !== "FAILED_VALIDATION",
        next_retry_at: qi.next_retry_at ?? null,
        category: extras.errorCategory ?? null,
        ...(extras.lastAttempt ?? {}),
      }),
      error_category: extras.errorCategory ?? null,
      error_message: errorMessage.slice(0, 2000),
      retry_count: qi.retry_count,
      batch_id: trace?.batch_id ?? null,
      request_id: trace?.request_id ?? null,
      http_status: trace?.http_status ?? extras.lastAttempt?.http_status ?? null,
      request_trace: trace
        ? safeJson({
            url: trace.url,
            method: trace.method,
            headers: trace.headers,
            item_count: trace.item_count,
            idempotency_keys: trace.idempotency_keys,
            body: trace.request_body_preview,
            started_at: trace.started_at,
          })
        : null,
      response_trace: trace
        ? safeJson({
            http_status: trace.http_status ?? null,
            body: trace.response_body ?? null,
            error: trace.error ?? null,
            finished_at: trace.finished_at ?? null,
            duration_ms: trace.duration_ms ?? null,
          })
        : null,
      max_retries: extras.maxRetries ?? null,
      retry_exhausted: extras.retryExhausted ?? qi.status === "FAILED",
      status: qi.status === "FAILED_VALIDATION" ? "discarded" : "open",
    }).select("id").maybeSingle();

    // Append the attempt that pushed this item into the DLQ, with its trace.
    const itemId = (inserted as { id?: string } | null)?.id;
    if (itemId) {
      await (db as any).rpc("append_failed_sync_attempt", {
        _item_id: itemId,
        _attempt_number: qi.retry_count,
        _outcome: "failed",
        _http_status: trace?.http_status ?? null,
        _duration_ms: trace?.duration_ms ?? null,
        _request_trace: trace ? safeJson({ url: trace.url, headers: trace.headers, body: trace.request_body_preview }) : null,
        _response_trace: trace ? safeJson({ body: trace.response_body ?? null, error: trace.error ?? null }) : null,
        _error_message: errorMessage.slice(0, 2000),
      });
    }
  } catch (err) {
    console.warn("[dlq] failed to report failed sync item", err);
  }
}

function safeJson(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return { unserializable: true };
  }
}