import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Public webhook endpoint for Saudi gateways.
// URL pattern: /functions/v1/payments-webhook/{gateway}
// Signature verification is delegated to each adapter (handleWebhook).

import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { createClient } from "@matbex/client";
import { getAdapter, loadCredentials } from "../_shared/payments/registry.ts";
import type { PaymentGateway } from "../_shared/payments/types.ts";

const SUPPORTED: PaymentGateway[] = [
  "hyperpay", "stcpay", "paymob", "moyasar", "amazon_ps", "geidea",
];

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const pre = corsPreflight(req);
  if (pre) return pre;

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const gateway = parts[parts.length - 1] as PaymentGateway;
  if (!SUPPORTED.includes(gateway)) {
    return new Response(JSON.stringify({ error: "Unknown gateway" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const db = createClient(
    env("API_URL")!,
    env("SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let evt;
  try {
    const adapter = getAdapter(gateway);
    const creds = loadCredentials(gateway);
    evt = await adapter.handleWebhook(req, creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.from("payment_webhook_events").insert({
      gateway, event_id: `err_${crypto.randomUUID()}`,
      signature_verified: false, payload: {}, error: msg,
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Idempotent insert
  const { error: insertErr } = await db.from("payment_webhook_events").insert({
    gateway,
    event_id: evt.eventId,
    signature_verified: true,
    payload: evt.raw as any,
  });
  if (insertErr && !insertErr.message.includes("duplicate")) {
    return new Response(JSON.stringify({ error: insertErr.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (evt.gatewayIntentId) {
    const { data: intent } = await db
      .from("payment_intents")
      .select("*")
      .eq("gateway_intent_id", evt.gatewayIntentId)
      .maybeSingle();

    if (intent) {
      await db
        .from("payment_intents")
        .update({ status: evt.status })
        .eq("id", intent.id);

      if (evt.status === "captured") {
        await db.from("payment_transactions").insert({
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
          gateway_reference: evt.gatewayIntentId,
          raw_payload: evt.raw as any,
        });
      }
    }
  }

  await db
    .from("payment_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("gateway", gateway).eq("event_id", evt.eventId);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});