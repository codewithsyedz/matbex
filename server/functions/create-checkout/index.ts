import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import Stripe from "stripe";
import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { paymentOwner, SUBSCRIPTION_PRICES } from "../_shared/subscriptionPayment.ts";

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return respond({});
  try {
    const admin = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const { user, tenant } = await paymentOwner(admin, req);
    const { planName } = await req.json();
    if (typeof planName !== "string") return respond({ error: "Select a subscription plan" }, 400);
    const name = planName.toLowerCase();
    const priceConfig = SUBSCRIPTION_PRICES[name];
    if (!priceConfig) return respond({ error: "This plan is not available for checkout yet" }, 400);
    const { data: plan } = await admin.from("plans").select("id,price").eq("name", name).eq("is_active", true).single();
    if (!plan || Number(plan.price) * 100 !== priceConfig.amount) throw new Error("Subscription price is unavailable");
    const stripe = new Stripe(env("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2025-08-27.basil" });
    const price = await stripe.prices.retrieve(priceConfig.id);
    if (!price.active || price.currency !== "sar" || price.unit_amount !== priceConfig.amount || price.recurring?.interval !== "month") throw new Error("Subscription price could not be verified");
    if (tenant.stripe_customer_id) {
      const subscriptions = await stripe.subscriptions.list({ customer: tenant.stripe_customer_id, limit: 100 });
      if (subscriptions.data.some(s => ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(s.status))) return respond({ error: "A subscription already exists. Use Manage Subscription instead." }, 409);
    }
    const origin = req.headers.get("origin") ?? "https://www.matbex.com";
    const url = new URL(origin);
    if (!(url.hostname === "localhost" || ["matbex.com", "www.matbex.com", new URL(env("SITE_URL") ?? "https://matbex.com").hostname].includes(url.hostname) || url.hostname.endsWith(".matbex.com"))) throw new Error("Invalid checkout return address");
    const metadata = { user_id: user.id, tenant_id: tenant.id, plan_name: name };
    const session = await stripe.checkout.sessions.create({
      customer: tenant.stripe_customer_id ?? undefined,
      customer_email: tenant.stripe_customer_id ? undefined : user.email,
      client_reference_id: tenant.id,
      line_items: [{ price: priceConfig.id, quantity: 1 }],
      mode: "subscription",
      success_url: `${url.origin}/payment-success?flow=subscription&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${url.origin}/billing?canceled=true`,
      metadata, subscription_data: { metadata },
    }, { idempotencyKey: `checkout-${tenant.id}-${name}-${Math.floor(Date.now() / 300000)}` });
    return respond({ url: session.url, test: !session.livemode });
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Unable to start checkout" }, 400);
  }
});