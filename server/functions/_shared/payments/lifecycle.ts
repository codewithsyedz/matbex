// Closing payment intents that will never be paid: the cashier cancelled the card screen
// (payments-cancel), or the intent was abandoned (payments-reconciler). Always closes the
// gateway's payment page first, then asks the gateway with the restaurant's own key: a payment
// that went through is captured (so the POS can still record the sale), never cancelled.
//
// Pure logic with injected gateway / store, so it is testable without a database or Moyasar.

import type { VerifyResult } from "./types.ts";

export const OPEN_STATUSES = ["created", "pending", "authorized"];
export const PAID_STATUSES = ["captured", "refunded", "partial_refunded"];
/** Pending intents older than this get one last check, then are expired. */
export const MAX_OPEN_AGE_MS = 24 * 60 * 60 * 1000;

export interface LifecycleIntent {
  id: string;
  tenant_id: string;
  status: string;
  gateway_intent_id: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

export interface IntentGatewayOps {
  verify(intent: LifecycleIntent): Promise<VerifyResult>;
  /** Close the payment page (best effort; may be missing for a gateway). */
  cancel?(intent: LifecycleIntent): Promise<void>;
}

export interface IntentStore {
  /** Store a gateway-verified status (applyVerifiedStatus). Returns the stored status. */
  apply(intent: LifecycleIntent, result: VerifyResult): Promise<string>;
  /**
   * Set a closed status and merge `meta` into metadata, only while the intent is still open
   * (a concurrent capture wins). Returns the intent's status after the attempt.
   */
  close(intent: LifecycleIntent, status: "canceled" | "expired", meta: Record<string, unknown>): Promise<string>;
  /** Merge `meta` into metadata without changing the status. */
  note(intent: LifecycleIntent, meta: Record<string, unknown>): Promise<void>;
}

export interface CloseOutcome {
  status: string;
  /** The customer paid: the POS should finish the sale with this intent. */
  paid: boolean;
  /** False when the gateway could not be asked; the intent stays open for the reconciler. */
  verified: boolean;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Close an open intent as `closeAs`, unless the gateway says it was paid.
 * `unverifiedFallback`: when the gateway cannot be asked, close anyway (reconciler, old intent)
 * instead of leaving it open with `cancel_requested_at` for the next reconciler run.
 */
export async function closeIntent(
  intent: LifecycleIntent,
  gw: IntentGatewayOps,
  store: IntentStore,
  opts: { closeAs: "canceled" | "expired"; meta: Record<string, unknown>; unverifiedFallback?: boolean },
): Promise<CloseOutcome> {
  if (PAID_STATUSES.includes(intent.status)) return { status: intent.status, paid: true, verified: true };
  if (!OPEN_STATUSES.includes(intent.status)) return { status: intent.status, paid: false, verified: true };

  const meta: Record<string, unknown> = { ...opts.meta };
  // Never reached the gateway (still creating, or creation failed): nothing can be paid.
  if (!intent.gateway_intent_id) {
    const status = await store.close(intent, opts.closeAs, meta);
    return { status, paid: PAID_STATUSES.includes(status), verified: true };
  }

  if (gw.cancel) {
    try { await gw.cancel(intent); }
    catch (e) { meta.gateway_cancel_error = errMsg(e).slice(0, 300); }
  }

  let result: VerifyResult;
  try {
    result = await gw.verify(intent);
  } catch (e) {
    if (opts.unverifiedFallback) {
      const status = await store.close(intent, opts.closeAs, { ...meta, closed_unverified: true, verify_error: errMsg(e).slice(0, 300) });
      return { status, paid: PAID_STATUSES.includes(status), verified: false };
    }
    await store.note(intent, { ...meta, cancel_requested_at: meta.cancelled_at ?? new Date().toISOString(), verify_error: errMsg(e).slice(0, 300) });
    return { status: intent.status, paid: false, verified: false };
  }

  if (PAID_STATUSES.includes(result.status)) {
    const status = await store.apply(intent, result);
    return { status, paid: PAID_STATUSES.includes(status), verified: true };
  }
  const status = await store.close(intent, opts.closeAs, { ...meta, gateway_status: result.status });
  return { status, paid: PAID_STATUSES.includes(status), verified: true };
}

/** Cashier pressed "Cancel payment" (payments-cancel). */
export function cancelIntent(
  intent: LifecycleIntent, gw: IntentGatewayOps, store: IntentStore, actorId: string, now = new Date(),
): Promise<CloseOutcome> {
  return closeIntent(intent, gw, store, {
    closeAs: "canceled",
    meta: { cancelled_at: now.toISOString(), cancelled_by: actorId, cancel_source: "pos" },
  });
}

/**
 * One reconciler pass over an open intent:
 *  - a cancel that could not be verified earlier (cancel_requested_at) is finished;
 *  - an intent older than MAX_OPEN_AGE_MS gets one last check and is expired;
 *  - otherwise the gateway's status is stored when it changed.
 */
export async function reconcileIntent(
  intent: LifecycleIntent, gw: IntentGatewayOps, store: IntentStore, now = new Date(), maxAgeMs = MAX_OPEN_AGE_MS,
): Promise<string> {
  const age = now.getTime() - new Date(intent.created_at).getTime();
  const cancelRequested = !!intent.metadata?.cancel_requested_at;
  if (cancelRequested) {
    const r = await closeIntent(intent, gw, store, {
      closeAs: "canceled",
      meta: { cancel_finished_at: now.toISOString() },
      unverifiedFallback: age > maxAgeMs,
    });
    return r.status;
  }
  if (age > maxAgeMs) {
    const r = await closeIntent(intent, gw, store, {
      closeAs: "expired",
      meta: { expired_at: now.toISOString(), expired_by: "reconciler" },
      unverifiedFallback: true,
    });
    return r.status;
  }
  if (!intent.gateway_intent_id) return intent.status; // still being created
  const result = await gw.verify(intent);
  if (result.status === intent.status) return intent.status;
  return store.apply(intent, result);
}
