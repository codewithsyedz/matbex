import { serve } from "../_runtime/serve.ts";
import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { getAdapter, loadTenantCredentials } from "../_shared/payments/registry.ts";
import type {
  PaymentGateway,
  PaymentMethod,
} from "../_shared/payments/types.ts";

interface Body {
  amount: number;
  method: PaymentMethod;
  branch_id?: string;
  terminal_id?: string;
  order_id?: string;
  idempotency_key?: string;
  return_url?: string;
  channel?: "pos" | "online";
  metadata?: Record<string, unknown>;
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const pre = corsPreflight(req);
  if (pre) return pre;

  let auth;
  try {
    auth = await requireUser(req);
  } catch (r) {
    if (r instanceof Response) {
      const t = await r.text();
      return new Response(t, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
    }
    throw r;
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (!body.amount || body.amount <= 0) {
    return new Response(JSON.stringify({ error: "amount must be > 0" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!body.method) {
    return new Response(JSON.stringify({ error: "method is required" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await auth.db
    .from("profiles")
    .select("tenant_id")
    .eq("id", auth.userId)
    .maybeSingle();
  const tenantId = profile?.tenant_id;
  if (!tenantId) {
    return new Response(JSON.stringify({ error: "No tenant for user" }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Pick gateway: branch override → tenant default → highest priority that supports the method
  const { data: configs } = await auth.db
    .from("payment_gateway_configs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .order("priority", { ascending: true });

  const candidates = (configs ?? []).filter((c: any) => {
    if (c.branch_id && body.branch_id && c.branch_id !== body.branch_id) return false;
    if (!c.allowed_methods?.includes(body.method)) return false;
    if (body.channel && c.channel !== "both" && c.channel !== body.channel) return false;
    return true;
  });
  // Prefer branch-specific over tenant-default
  candidates.sort((a: any, b: any) =>
    (a.branch_id ? 0 : 1) - (b.branch_id ? 0 : 1) || a.priority - b.priority,
  );
  const chosen = candidates[0];
  if (!chosen) {
    return new Response(
      JSON.stringify({ error: `No enabled gateway supports method '${body.method}'` }),
      { status: 422, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const gateway = chosen.gateway as PaymentGateway;
  const idempotencyKey = body.idempotency_key ?? crypto.randomUUID();

  // Insert intent first in 'created' state for full auditability
  const { data: intentRow, error: insertErr } = await auth.db
    .from("payment_intents")
    .insert({
      tenant_id: tenantId,
      branch_id: body.branch_id ?? null,
      terminal_id: body.terminal_id ?? null,
      order_id: body.order_id ?? null,
      amount: body.amount,
      currency: "SAR",
      method: body.method,
      gateway,
      status: "created",
      idempotency_key: idempotencyKey,
      metadata: body.metadata ?? {},
      created_by: auth.userId,
    })
    .select("*")
    .maybeSingle();

  if (insertErr || !intentRow) {
    return new Response(
      JSON.stringify({ error: insertErr?.message ?? "Failed to create intent" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  try {
    const adapter = getAdapter(gateway);
    const creds = await loadTenantCredentials(tenantId, gateway);
    const result = await adapter.createPaymentIntent({
      tenantId,
      branchId: body.branch_id,
      terminalId: body.terminal_id,
      orderId: body.order_id,
      amount: body.amount,
      method: body.method,
      idempotencyKey,
      returnUrl: body.return_url,
      metadata: body.metadata,
      credentials: creds,
    });

    await auth.db
      .from("payment_intents")
      .update({
        status: result.status,
        gateway_intent_id: result.gatewayIntentId,
        redirect_url: result.redirectUrl ?? null,
        qr_payload: result.qrPayload ?? null,
      })
      .eq("id", intentRow.id);

    return new Response(
      JSON.stringify({
        intent_id: intentRow.id,
        gateway,
        gateway_intent_id: result.gatewayIntentId,
        redirect_url: result.redirectUrl,
        qr_payload: result.qrPayload,
        client_secret: result.clientSecret,
        status: result.status,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await auth.db
      .from("payment_intents")
      .update({ status: "failed", metadata: { ...(intentRow.metadata ?? {}), error: msg } })
      .eq("id", intentRow.id);
    return new Response(JSON.stringify({ error: msg, intent_id: intentRow.id }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});