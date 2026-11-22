import { serve } from "../_runtime/serve.ts";
import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { requireUser, userHasTenantRole } from "../_shared/auth.ts";
import { getAdapter, loadTenantCredentials } from "../_shared/payments/registry.ts";
import type { PaymentGateway } from "../_shared/payments/types.ts";
import { serviceClient } from "../_shared/payments/settle.ts";

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

  const { intent_id, amount } = await req.json().catch(() => ({}));
  if (!intent_id || !amount || amount <= 0) {
    return new Response(JSON.stringify({ error: "intent_id and positive amount required" }), {
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

  const ok = await userHasTenantRole(auth.db, auth.userId, intent.tenant_id, ["owner", "manager"]);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Refunds require manager role" }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (!["captured", "partial_refunded"].includes(intent.status)) {
    return new Response(JSON.stringify({ error: "Only a paid payment can be refunded" }), {
      status: 409, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const svc = serviceClient();
  const { data: prior } = await svc.from("payment_transactions").select("amount")
    .eq("intent_id", intent.id).eq("kind", "refund").eq("status", "success");
  const alreadyRefunded = (prior ?? []).reduce((s: number, r: any) => s + Math.abs(Number(r.amount)), 0);
  // A POS sale paid partly by card (split tender): only its card tender paid through this
  // payment goes back to the card. The cash part is refunded from the drawer (sale void).
  let refundable = Number(intent.amount);
  if (intent.sales_transaction_id) {
    const { data: tender } = await svc.from("sale_payments").select("amount")
      .eq("sale_id", intent.sales_transaction_id).eq("method", "card")
      .eq("card_provider", intent.gateway).eq("card_reference", intent.id)
      .gt("amount", 0).maybeSingle();
    const { data: sale } = await svc.from("sales_transactions").select("payment_method")
      .eq("id", intent.sales_transaction_id).maybeSingle();
    if (sale?.payment_method === "split" && !tender) {
      return new Response(JSON.stringify({ error: "This payment is not a card tender of the sale" }), {
        status: 409, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (tender) refundable = Math.min(refundable, Number(tender.amount));
  }
  if (Number(amount) > refundable - alreadyRefunded + 0.005) {
    return new Response(JSON.stringify({ error: "Refund is more than what is left of this payment" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
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
      status: 424, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  await svc.from("payment_transactions").insert({
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
    status: result.status === "refunded" || result.status === "partial_refunded" ? "success" : "failed",
    gateway_reference: result.refundReference ?? null,
    raw_payload: result.raw as any,
    created_by: auth.userId,
  });

  if (result.status === "refunded" || result.status === "partial_refunded") {
    await svc
      .from("payment_intents")
      .update({
        status: alreadyRefunded + Number(amount) >= Number(intent.amount) - 0.005 ? "refunded" : "partial_refunded",
      })
      .eq("id", intent_id)
      .eq("tenant_id", intent.tenant_id);

    // A fully refunded online order shows as refunded (scoped to the intent's business).
    if (intent.order_id && alreadyRefunded + Number(amount) >= Number(intent.amount) - 0.005) {
      const { data: rs } = await svc.from("restaurants").select("id").eq("tenant_id", intent.tenant_id);
      const ids = (rs ?? []).map((r: { id: string }) => r.id);
      if (ids.length) {
        await svc.from("online_orders").update({ payment_status: "refunded" })
          .eq("id", intent.order_id).eq("payment_method", "online").in("restaurant_id", ids);
      }
    }
  }

  return new Response(JSON.stringify({ status: result.status }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});