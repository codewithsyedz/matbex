import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import Stripe from "stripe";
import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";

const log = (step: string, details?: unknown) => {
  const s = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[VERIFY-ADDON-PURCHASE] ${step}${s}`);
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId: string | undefined = body.session_id;
    if (!sessionId) throw new Error("session_id is required");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");

    const userClient = createClient(
      env("API_URL") ?? "",
      env("ANON_KEY") ?? ""
    );
    const { data: userData } = await userClient.auth.getUser(token);
    const user = userData.user;
    if (!user) throw new Error("Not authenticated");

    const stripeKey = env("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    log("Session", { id: session.id, status: session.status, payment_status: session.payment_status });

    const tenantId = session.metadata?.tenant_id;
    const addonId = session.metadata?.addon_id;
    if (!tenantId || !addonId) throw new Error("Session metadata missing tenant/addon");

    const admin = createClient(
      env("API_URL") ?? "",
      env("SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const paid =
      session.payment_status === "paid" ||
      session.status === "complete" ||
      (session.mode === "subscription" && !!session.subscription);

    if (!paid) {
      return new Response(JSON.stringify({ activated: false, status: session.payment_status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const update: Record<string, unknown> = {
      status: "active",
      activated_at: new Date().toISOString(),
    };
    if (session.subscription && typeof session.subscription === "string") {
      update.stripe_subscription_id = session.subscription;
    }

    const { error: upErr } = await admin
      .from("tenant_addons")
      .update(update)
      .eq("tenant_id", tenantId)
      .eq("addon_id", addonId)
      .eq("stripe_checkout_session_id", sessionId);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ activated: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ERROR", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
