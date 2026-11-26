import { serve } from "../_runtime/serve.ts";
import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { getAdapter, loadTenantCredentials } from "../_shared/payments/registry.ts";
import { applyVerifiedStatus, type IntentRow } from "../_shared/payments/settle.ts";
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

  // Always verify with the gateway, with the restaurant's own keys - never trust the client.
  const adapter = getAdapter(intent.gateway as PaymentGateway);
  const creds = await loadTenantCredentials(intent.tenant_id, intent.gateway as PaymentGateway);
  let result;
  try {
    result = await adapter.verifyPayment(intent.gateway_intent_id ?? "", creds);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 424, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const status = await applyVerifiedStatus(intent as IntentRow, result, auth.userId);

  return new Response(JSON.stringify({ status, intent_id }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});