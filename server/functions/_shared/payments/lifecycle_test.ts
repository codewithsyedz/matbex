import { test } from "node:test";
import { deepStrictEqual as eq, ok } from "node:assert/strict";
import {
  cancelIntent, reconcileIntent, MAX_OPEN_AGE_MS,
  type IntentGatewayOps, type IntentStore, type LifecycleIntent,
} from "./lifecycle.ts";
import type { NormalizedStatus } from "./types.ts";

const NOW = new Date("2026-11-23T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function intent(over: Partial<LifecycleIntent> = {}): LifecycleIntent {
  return { id: "pi_1", tenant_id: "t_1", status: "pending", gateway_intent_id: "inv_1", created_at: ago(5 * 60_000), metadata: {}, ...over };
}

/** In-memory store + gateway that record what happened, in order. */
function harness(gatewayStatus: NormalizedStatus | Error, opts: { cancelFails?: boolean } = {}) {
  const log: string[] = [];
  const rows = new Map<string, { status: string; metadata: Record<string, unknown> }>();
  const gw: IntentGatewayOps = {
    async cancel(i) {
      log.push(`gw.cancel:${i.gateway_intent_id}`);
      if (opts.cancelFails) throw new Error("Moyasar: invoice already paid");
    },
    async verify(i) {
      log.push(`gw.verify:${i.gateway_intent_id}`);
      if (gatewayStatus instanceof Error) throw gatewayStatus;
      return { status: gatewayStatus, gatewayReference: "pay_1", raw: {} };
    },
  };
  const store: IntentStore = {
    async apply(i, r) { log.push(`apply:${r.status}`); rows.set(i.id, { status: r.status, metadata: i.metadata ?? {} }); return r.status; },
    async close(i, status, meta) {
      log.push(`close:${status}`);
      rows.set(i.id, { status, metadata: { ...(i.metadata ?? {}), ...meta } });
      return status;
    },
    async note(i, meta) { log.push("note"); rows.set(i.id, { status: i.status, metadata: { ...(i.metadata ?? {}), ...meta } }); },
  };
  return { gw, store, log, rows };
}

test("cancel: unpaid intent closes Moyasar's page first, then is cancelled", async () => {
  const h = harness("pending");
  const r = await cancelIntent(intent(), h.gw, h.store, "user_1", NOW);
  eq(r, { status: "canceled", paid: false, verified: true });
  eq(h.log, ["gw.cancel:inv_1", "gw.verify:inv_1", "close:canceled"]);
  const m = h.rows.get("pi_1")!.metadata;
  eq(m.cancelled_by, "user_1");
  eq(m.cancelled_at, NOW.toISOString());
  eq(m.gateway_status, "pending");
});

test("cancel: a payment that went through is captured, not cancelled", async () => {
  const h = harness("captured", { cancelFails: true });
  const r = await cancelIntent(intent(), h.gw, h.store, "user_1", NOW);
  eq(r, { status: "captured", paid: true, verified: true });
  eq(h.log, ["gw.cancel:inv_1", "gw.verify:inv_1", "apply:captured"]);
});

test("cancel: gateway cancel failure is noted but the verified answer still decides", async () => {
  const h = harness("canceled", { cancelFails: true });
  const r = await cancelIntent(intent(), h.gw, h.store, "user_1", NOW);
  eq(r.status, "canceled");
  ok(String(h.rows.get("pi_1")!.metadata.gateway_cancel_error).includes("already paid"));
});

test("cancel: gateway unreachable leaves the intent open with cancel_requested_at", async () => {
  const h = harness(new Error("timeout"));
  const r = await cancelIntent(intent(), h.gw, h.store, "user_1", NOW);
  eq(r, { status: "pending", paid: false, verified: false });
  eq(h.log, ["gw.cancel:inv_1", "gw.verify:inv_1", "note"]);
  eq(h.rows.get("pi_1")!.metadata.cancel_requested_at, NOW.toISOString());
});

test("cancel: intent without a gateway invoice yet is cancelled without asking the gateway", async () => {
  const h = harness("pending");
  const r = await cancelIntent(intent({ status: "created", gateway_intent_id: null }), h.gw, h.store, "user_1", NOW);
  eq(r.status, "canceled");
  eq(h.log, ["close:canceled"]);
});

test("cancel: already captured or already closed intents are left alone", async () => {
  const h = harness("pending");
  eq(await cancelIntent(intent({ status: "captured" }), h.gw, h.store, "u", NOW), { status: "captured", paid: true, verified: true });
  eq(await cancelIntent(intent({ status: "expired" }), h.gw, h.store, "u", NOW), { status: "expired", paid: false, verified: true });
  eq(h.log, []);
});

test("reconcile: a young pending intent only stores a changed gateway status", async () => {
  const same = harness("pending");
  eq(await reconcileIntent(intent(), same.gw, same.store, NOW), "pending");
  eq(same.log, ["gw.verify:inv_1"]);

  const paid = harness("captured");
  eq(await reconcileIntent(intent(), paid.gw, paid.store, NOW), "captured");
  eq(paid.log, ["gw.verify:inv_1", "apply:captured"]);
});

test("reconcile: intents older than the window get one last check, then expire", async () => {
  const h = harness("pending");
  eq(await reconcileIntent(intent({ created_at: ago(MAX_OPEN_AGE_MS + 1) }), h.gw, h.store, NOW), "expired");
  eq(h.log, ["gw.cancel:inv_1", "gw.verify:inv_1", "close:expired"]);
  eq(h.rows.get("pi_1")!.metadata.expired_by, "reconciler");
});

test("reconcile: an old intent that was actually paid is captured, not expired", async () => {
  const h = harness("captured");
  eq(await reconcileIntent(intent({ created_at: ago(MAX_OPEN_AGE_MS + 1) }), h.gw, h.store, NOW), "captured");
});

test("reconcile: an old intent whose gateway cannot be asked is still expired (unverified)", async () => {
  const h = harness(new Error("Moyasar is not set up"));
  eq(await reconcileIntent(intent({ created_at: ago(MAX_OPEN_AGE_MS + 1) }), h.gw, h.store, NOW), "expired");
  eq(h.rows.get("pi_1")!.metadata.closed_unverified, true);
});

test("reconcile: a young unreachable intent throws so it is retried next run", async () => {
  const h = harness(new Error("timeout"));
  let threw = false;
  try { await reconcileIntent(intent(), h.gw, h.store, NOW); } catch { threw = true; }
  ok(threw);
  eq(h.log, ["gw.verify:inv_1"]);
});

test("reconcile: finishes a POS cancel that could not reach the gateway", async () => {
  const h = harness("pending");
  const i = intent({ metadata: { cancel_requested_at: ago(60_000), cancelled_by: "user_1" } });
  eq(await reconcileIntent(i, h.gw, h.store, NOW), "canceled");
  eq(h.log, ["gw.cancel:inv_1", "gw.verify:inv_1", "close:canceled"]);
  eq(h.rows.get("pi_1")!.metadata.cancelled_by, "user_1");
});

test("reconcile: an old 'created' intent without an invoice expires", async () => {
  const h = harness("pending");
  eq(await reconcileIntent(intent({ status: "created", gateway_intent_id: null, created_at: ago(MAX_OPEN_AGE_MS + 1) }), h.gw, h.store, NOW), "expired");
  eq(h.log, ["close:expired"]);
});
