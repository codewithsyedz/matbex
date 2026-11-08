import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { paymentOwner, verifiedPaidPlan } from "../_shared/subscriptionPayment.ts";

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return respond({});
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const { user, tenant } = await paymentOwner(admin, req);
    const { session_id } = await req.json();
    if (typeof session_id !== "string" || !/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(session_id)) return respond({ error: "Invalid payment session" }, 400);
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2025-08-27.basil" });
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ["subscription", "line_items"] });
    // Preserve the separate application-registration checkout flow.
    if (session.metadata?.application_id) return respond({ registration: true });
    const sub = session.subscription;
    if (!sub || typeof sub === "string") return respond({ error: "Payment has not completed yet" }, 409);
    const priceId = sub.items.data[0]?.price.id ?? "";
    const planName = verifiedPaidPlan(session, tenant.id, user.id, priceId, sub.status);
    if (session.line_items?.data.length !== 1 || session.line_items.data[0]?.price?.id !== priceId) throw new Error("Payment items could not be verified");
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (!customerId || (tenant.stripe_customer_id && tenant.stripe_customer_id !== customerId)) throw new Error("Payment customer could not be verified");
    const { data: plan, error: planError } = await admin.from("plans").select("id").eq("name", planName).eq("is_active", true).single();
    if (planError || !plan) throw new Error("Subscription plan is unavailable");
    const periodEnd = sub.items.data[0]?.current_period_end;
    const { error } = await admin.from("tenants").update({ plan_id: plan.id, status: "active", stripe_customer_id: customerId, trial_ends_at: null, current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null }).eq("id", tenant.id);
    if (error) throw new Error("Payment received; account activation needs a retry");
    return respond({ success: true, plan: planName, test: !session.livemode });
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Payment verification failed" }, 400);
  }
});