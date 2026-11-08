import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { requireUser, userHasTenantRole } from "../_shared/auth.ts";
import { getAdapter, loadTenantCredentials } from "../_shared/payments/registry.ts";
import type { PaymentGateway } from "../_shared/payments/types.ts";

Deno.serve(async (req) => {
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

  const { intent_id, amount } = await req.json().catch(() => ({}));
  if (!intent_id || !amount || amount <= 0) {
    return new Response(JSON.stringify({ error: "intent_id and positive amount required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: intent } = await auth.supabase
    .from("payment_intents").select("*").eq("id", intent_id).maybeSingle();
  if (!intent) {
    return new Response(JSON.stringify({ error: "Intent not found" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const ok = await userHasTenantRole(auth.supabase, auth.userId, intent.tenant_id, ["owner", "manager"]);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Refunds require manager role" }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const adapter = getAdapter(intent.gateway as PaymentGateway);
  const creds = await loadTenantCredentials(intent.tenant_id, intent.gateway as PaymentGateway);

  let result;
  try {
    result = await adapter.refundPayment(intent.gateway_intent_id ?? "", Number(amount), creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  await auth.supabase.from("payment_transactions").insert({
    tenant_id: intent.tenant_id,
    branch_id: intent.branch_id,
    terminal_id: intent.terminal_id,
    intent_id: intent.id,
    order_id: intent.order_id,
    kind: "refund",
    gateway: intent.gateway,
    method: intent.method,
    amount: -Math.abs(Number(amount)),
    currency: intent.currency,
    status: result.status === "refunded" ? "success" : "failed",
    gateway_reference: result.refundReference ?? null,
    raw_payload: result.raw as any,
    created_by: auth.userId,
  });

  await auth.supabase
    .from("payment_intents")
    .update({
      status: Number(amount) >= Number(intent.amount) ? "refunded" : "partial_refunded",
    })
    .eq("id", intent_id);

  return new Response(JSON.stringify({ status: result.status }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});