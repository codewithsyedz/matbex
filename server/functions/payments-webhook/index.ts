import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Public webhook endpoint for Saudi gateways.
// URL pattern: /functions/v1/payments-webhook/{gateway}
// Signature verification is delegated to each adapter (handleWebhook).

import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { createClient } from "@matbex/client";
import { getAdapter, loadCredentials, loadTenantCredentials } from "../_shared/payments/registry.ts";
import { applyVerifiedStatus, type IntentRow } from "../_shared/payments/settle.ts";
import { settleSubscriptionPayment, type SubscriptionPaymentRow } from "../_shared/billing/platformMoyasar.ts";
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
      .eq("gateway", gateway)
      .eq("gateway_intent_id", evt.gatewayIntentId)
      .maybeSingle();

    // Not a restaurant's payment: maybe a Matbex subscription payment (Matbex's own account).
    if (!intent && gateway === "moyasar") {
      const { data: sub } = await db.from("subscription_payments").select("*")
        .eq("moyasar_invoice_id", evt.gatewayIntentId).maybeSingle();
      if (sub) {
        try {
          await settleSubscriptionPayment(sub as SubscriptionPaymentRow);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await db.from("payment_webhook_events").update({ error: msg })
            .eq("gateway", gateway).eq("event_id", evt.eventId);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500, headers: { ...cors, "Content-Type": "application/json" },
          });
        }
      }
    }

    if (intent) {
      try {
        // Unsigned notifications (Moyasar) are only a hint: ask the gateway with the
        // restaurant's own keys. Signed ones (HyperPay) carry a trusted status.
        const result = evt.verifyWithGateway
          ? await getAdapter(gateway).verifyPayment(evt.gatewayIntentId, await loadTenantCredentials(intent.tenant_id, gateway))
          : { status: evt.status, gatewayReference: evt.gatewayIntentId, raw: evt.raw };
        await applyVerifiedStatus(intent as IntentRow, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.from("payment_webhook_events").update({ error: msg })
          .eq("gateway", gateway).eq("event_id", evt.eventId);
        // 500 so the gateway retries later.
        return new Response(JSON.stringify({ error: msg }), {
          status: 500, headers: { ...cors, "Content-Type": "application/json" },
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