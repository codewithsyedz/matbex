import { serve } from "../_runtime/serve.ts";
// Records a non-gateway payment directly into the ledger.
// Used for cash and external bank-terminal card payments.
// No gateway round-trip - peak-hour safe.

import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

type Kind = "cash" | "external_card_recorded";
type Method = "cash" | "external_card";

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

  const body = await req.json().catch(() => ({} as any));
  const amount = Number(body.amount);
  const kind = body.kind as Kind;
  const method = body.method as Method;

  if (!amount || amount <= 0) {
    return new Response(JSON.stringify({ error: "amount must be > 0" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!["cash", "external_card_recorded"].includes(kind)) {
    return new Response(JSON.stringify({ error: "invalid kind" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!["cash", "external_card"].includes(method)) {
    return new Response(JSON.stringify({ error: "invalid method" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await auth.db
    .from("profiles").select("tenant_id").eq("id", auth.userId).maybeSingle();
  const tenantId = profile?.tenant_id;
  if (!tenantId) {
    return new Response(JSON.stringify({ error: "No tenant" }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await auth.db.from("payment_transactions").insert({
    tenant_id: tenantId,
    branch_id: body.branch_id ?? null,
    terminal_id: body.terminal_id ?? null,
    order_id: body.order_id ?? null,
    kind,
    method,
    gateway: null,
    amount,
    currency: "SAR",
    status: "success",
    gateway_reference: body.reference ?? null,
    raw_payload: body.metadata ?? {},
    created_by: auth.userId,
  }).select("id").maybeSingle();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ transaction_id: data?.id }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});