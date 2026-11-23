// Shared server-side writes for payment intents. Browsers can read their tenant's intents but
// not write them (migration 20261115165720), so every status change goes through here with the
// service client, after the caller's access was checked and the status verified with the gateway.

import { createClient } from "@matbex/client";
import { env } from "../../_runtime/env.ts";
import type { VerifyResult } from "./types.ts";

export function serviceClient() {
  return createClient(env("API_URL")!, env("SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

export interface IntentRow {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  terminal_id: string | null;
  order_id: string | null;
  gateway: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
  gateway_intent_id: string | null;
}

/** Callback URL a gateway posts to when a payment changes (public function payments-webhook). */
export function notifyUrl(gateway: string): string | undefined {
  const base = env("API_URL");
  return base?.startsWith("https://") ? `${base.replace(/\/$/, "")}/functions/v1/payments-webhook/${gateway}` : undefined;
}

/**
 * Store a status the gateway itself reported. A capture also records the charge in
 * payment_transactions, once per intent (unique index; a repeat from the webhook and the POS
 * poll is ignored). A final state (captured/refunded) is never moved back to pending.
 */
export async function applyVerifiedStatus(intent: IntentRow, result: VerifyResult, actorId: string | null = null) {
  const db = serviceClient();
  const final = ["captured", "refunded", "partial_refunded"];
  if (final.includes(intent.status) && !final.includes(result.status)) return intent.status;

  const { error: upErr } = await db
    .from("payment_intents")
    .update({ status: result.status, gateway_reference: result.gatewayReference ?? null, updated_at: new Date().toISOString() })
    .eq("id", intent.id)
    .eq("tenant_id", intent.tenant_id);
  if (upErr) throw new Error(upErr.message);

  if (result.status === "captured") {
    const { error } = await db.from("payment_transactions").insert({
      tenant_id: intent.tenant_id,
      branch_id: intent.branch_id,
      terminal_id: intent.terminal_id,
      intent_id: intent.id,
      order_id: intent.order_id,
      kind: "charge",
      gateway: intent.gateway,
      method: intent.method,
      amount: intent.amount,
      currency: intent.currency,
      status: "success",
      gateway_reference: result.gatewayReference ?? null,
      raw_payload: (result.raw ?? {}) as Record<string, unknown>,
      created_by: actorId,
    });
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);

    // An online order paid online (online-order-pay): mark it paid. Scoped to the intent's
    // business so an intent can only ever settle that business's order.
    if (intent.order_id) {
      const { data: rs } = await db.from("restaurants").select("id").eq("tenant_id", intent.tenant_id);
      const ids = (rs ?? []).map((r: { id: string }) => r.id);
      if (ids.length) {
        const { error: oErr } = await db.from("online_orders")
          .update({ payment_status: "paid" })
          .eq("id", intent.order_id)
          .eq("payment_method", "online")
          .in("restaurant_id", ids);
        if (oErr) throw new Error(oErr.message);
      }
    }
  }
  return result.status;
}

/** IntentStore (lifecycle.ts) on the service client. */
export function intentStore(): import("./lifecycle.ts").IntentStore {
  const db = serviceClient();
  const current = async (id: string) => {
    const { data } = await db.from("payment_intents").select("status").eq("id", id).maybeSingle();
    return (data?.status as string | undefined) ?? "unknown";
  };
  return {
    apply: (intent, result) => applyVerifiedStatus(intent as unknown as IntentRow, result),
    async close(intent, status, meta) {
      const { data, error } = await db
        .from("payment_intents")
        .update({ status, metadata: { ...(intent.metadata ?? {}), ...meta }, updated_at: new Date().toISOString() })
        .eq("id", intent.id)
        .eq("tenant_id", intent.tenant_id)
        .in("status", ["created", "pending", "authorized"])
        .select("status");
      if (error) throw new Error(error.message);
      return data?.length ? status : current(intent.id);
    },
    async note(intent, meta) {
      const { error } = await db
        .from("payment_intents")
        .update({ metadata: { ...(intent.metadata ?? {}), ...meta }, updated_at: new Date().toISOString() })
        .eq("id", intent.id)
        .eq("tenant_id", intent.tenant_id);
      if (error) throw new Error(error.message);
    },
  };
}
