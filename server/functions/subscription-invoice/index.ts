import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Tax invoice for one of Matbex's own subscription payments (owners of the paying business).
// POST { payment_id } -> invoice data the Billing page renders and prints (with the ZATCA QR).
// Invoice data: _shared/billing/subscriptionInvoice.ts.

import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { paymentOwner } from "../_shared/subscriptionPayment.ts";
import { buildSubscriptionInvoice } from "../_shared/billing/subscriptionInvoice.ts";

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  let owner;
  try {
    owner = await paymentOwner(admin, req);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Please sign in" }, 403);
  }
  const { payment_id } = await req.json().catch(() => ({}));
  if (typeof payment_id !== "string" || !/^[0-9a-f-]{36}$/i.test(payment_id)) return json({ error: "Invalid payment" }, 400);

  const invoice = await buildSubscriptionInvoice(admin, payment_id, owner.tenant.id);
  if (!invoice) return json({ error: "No invoice for this payment" }, 404);
  return json(invoice);
});
