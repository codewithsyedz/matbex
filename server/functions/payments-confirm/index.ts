import { serve } from "../_runtime/serve.ts";
import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { getAdapter, loadCredentials } from "../_shared/payments/registry.ts";
import type { PaymentGateway } from "../_shared/payments/types.ts";

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const pre = corsPreflight(req);
  if (pre) return pre;

  let auth;
  try { auth = await requireUser(req); }
  catch (r) {
    if (r instanceof Response) {
      const t = await r.text();
      return new Response(t, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
    }
    throw r;
  }

  const { intent_id } = await req.json().catch(() => ({}));
  if (!intent_id) {
    return new Response(JSON.stringify({ error: "intent_id required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: intent } = await auth.db
    .from("payment_intents").select("*").eq("id", intent_id).maybeSingle();
  if (!intent) {
    return new Response(JSON.stringify({ error: "Intent not found" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Always verify with the gateway - never trust the client.
  const adapter = getAdapter(intent.gateway as PaymentGateway);
  const creds = loadCredentials(intent.gateway as PaymentGateway);
  const result = await adapter.verifyPayment(intent.gateway_intent_id ?? "", creds);

  await auth.db
    .from("payment_intents")
    .update({ status: result.status, gateway_reference: result.gatewayReference ?? null })
    .eq("id", intent_id);

  if (result.status === "captured") {
    await auth.db.from("payment_transactions").insert({
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
      raw_payload: result.raw as any,
      created_by: auth.userId,
    });
  }

  return new Response(JSON.stringify({ status: result.status, intent_id }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});