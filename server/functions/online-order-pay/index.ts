import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Online payment of a customer's online order (public order page), through the restaurant's own
// Moyasar account. Public: the customer is usually not signed in. It never takes an amount from
// the caller: the payable total is the order's server-priced total (public_create_online_order),
// and "paid" is only ever what Moyasar itself reports (verifyPayment with the restaurant's key).
//
// POST { action: "available", restaurant_id }  -> { available }       (show "Pay online"?)
// POST { action: "start", order_id, return_url? } -> { redirect_url } | { paid: true }
// POST { action: "status", order_id }          -> { payment_status }   (after the redirect back)

import { z } from "zod";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getAdapter, loadTenantCredentials } from "../_shared/payments/registry.ts";
import { applyVerifiedStatus, notifyUrl, serviceClient, type IntentRow } from "../_shared/payments/settle.ts";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("available"), restaurant_id: z.string().uuid() }),
  z.object({ action: z.literal("start"), order_id: z.string().uuid(), return_url: z.string().url().max(500).optional() }),
  z.object({ action: z.literal("status"), order_id: z.string().uuid() }),
]);

/** An unpaid Moyasar invoice is reused for this long (it is payable for 30 minutes). */
const REUSE_MINUTES = 25;

type Db = ReturnType<typeof serviceClient>;

async function moyasarEnabled(db: Db, restaurantId: string): Promise<string | null> {
  const { data: r } = await db.from("restaurants").select("tenant_id").eq("id", restaurantId).maybeSingle();
  const tenantId = r?.tenant_id as string | undefined;
  if (!tenantId) return null;
  const { data: cfg } = await db.from("payment_gateway_configs").select("id")
    .eq("tenant_id", tenantId).eq("gateway", "moyasar").eq("enabled", true)
    .in("channel", ["online", "both"]).is("branch_id", null).limit(1);
  if (!cfg?.length) return null;
  const creds = await loadTenantCredentials(tenantId, "moyasar");
  return creds.MOYASAR_SECRET_KEY ? tenantId : null;
}

/** Where Moyasar sends the customer back: the order's tracking page on a Matbex host. */
function trackingUrl(orderId: string, requested?: string): string | undefined {
  const site = env("SITE_URL");
  const path = `/order/track/${orderId}`;
  if (!site) return undefined;
  const siteUrl = new URL(site);
  const parent = siteUrl.hostname.split(".").slice(-2).join(".");
  if (requested) {
    try {
      const u = new URL(requested);
      const sameFamily = u.hostname === parent || u.hostname.endsWith(`.${parent}`);
      if (u.protocol === "https:" && sameFamily && u.pathname === path) return u.toString();
    } catch { /* fall back */ }
  }
  return `${siteUrl.origin}${path}`;
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const body = parsed.data;
  const db = serviceClient();

  if (body.action === "available") {
    return json({ available: !!(await moyasarEnabled(db, body.restaurant_id)) });
  }

  const { data: order } = await db.from("online_orders")
    .select("id, restaurant_id, status, total, payment_method, payment_status")
    .eq("id", body.order_id).maybeSingle();
  if (!order || order.payment_method !== "online") return json({ error: "Order not found" }, 404);

  const { data: intents } = await db.from("payment_intents").select("*")
    .eq("order_id", order.id).eq("gateway", "moyasar").order("created_at", { ascending: false }).limit(5);
  const latest = (intents ?? [])[0] as (IntentRow & { created_at: string; redirect_url: string | null }) | undefined;

  // Ask Moyasar about the latest payment page of this order (never trust the caller).
  const refresh = async () => {
    if (!latest?.gateway_intent_id || latest.status === "captured") return latest?.status ?? null;
    const creds = await loadTenantCredentials(latest.tenant_id, "moyasar");
    const result = await getAdapter("moyasar").verifyPayment(latest.gateway_intent_id, creds);
    return await applyVerifiedStatus(latest, result);
  };

  if (body.action === "status") {
    try {
      await refresh();
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 424);
    }
    const { data: fresh } = await db.from("online_orders").select("payment_status").eq("id", order.id).maybeSingle();
    return json({ payment_status: fresh?.payment_status ?? order.payment_status });
  }

  // start
  if (order.payment_status === "paid") return json({ paid: true });
  if (order.status === "cancelled") return json({ error: "This order was cancelled" }, 409);
  const tenantId = await moyasarEnabled(db, order.restaurant_id);
  if (!tenantId) return json({ error: "Online payment is not available for this restaurant" }, 409);

  try {
    if ((await refresh()) === "captured") return json({ paid: true });
  } catch { /* a failed check must not block starting a new payment */ }

  const fresh = latest && latest.status === "pending" && latest.redirect_url &&
    Date.now() - new Date(latest.created_at).getTime() < REUSE_MINUTES * 60_000;
  if (fresh) return json({ redirect_url: latest!.redirect_url });

  const amount = Number(order.total);
  const { data: intent, error: insErr } = await db.from("payment_intents").insert({
    tenant_id: tenantId,
    order_id: order.id,
    amount,
    currency: "SAR",
    method: "card",
    gateway: "moyasar",
    status: "created",
    idempotency_key: `online-order:${order.id}:${crypto.randomUUID()}`,
    metadata: { channel: "online", restaurant_id: order.restaurant_id },
  }).select("*").maybeSingle();
  if (insErr || !intent) return json({ error: insErr?.message ?? "Could not start the payment" }, 500);

  try {
    const result = await getAdapter("moyasar").createPaymentIntent({
      tenantId,
      orderId: order.id,
      amount,
      method: "card",
      idempotencyKey: intent.id,
      returnUrl: trackingUrl(order.id, body.return_url),
      notifyUrl: notifyUrl("moyasar"),
      metadata: { description: `Online order ${order.id.slice(0, 8)}` },
      credentials: await loadTenantCredentials(tenantId, "moyasar"),
    });
    await db.from("payment_intents").update({
      status: result.status,
      gateway_intent_id: result.gatewayIntentId,
      redirect_url: result.redirectUrl ?? null,
    }).eq("id", intent.id);
    return json({ redirect_url: result.redirectUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("payment_intents").update({ status: "failed", metadata: { ...(intent.metadata ?? {}), error: msg } }).eq("id", intent.id);
    return json({ error: "The payment page could not be opened. Try again or choose cash." }, 424);
  }
});
