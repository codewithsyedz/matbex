import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import Stripe from "stripe";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
// Plan to Stripe price ID mapping
const PLAN_PRICES: Record<string, string> = {
  pro: "price_1SFOA52MlXQdnUvp6fvItZdK",
  enterprise: "price_1SFOAM2MlXQdnUvpxav6zSpe",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[REGISTRATION-CHECKOUT] ${step}${detailsStr}`);
};

interface RegistrationCheckoutRequest {
  application_id: string;
  plan_name: string;
  email: string;
  full_name: string;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { application_id, plan_name, email, full_name }: RegistrationCheckoutRequest = await req.json();
    
    if (!application_id || !plan_name || !email) {
      throw new Error("Missing required fields: application_id, plan_name, email");
    }

    const planKey = plan_name.toLowerCase();
    const priceId = PLAN_PRICES[planKey];
    
    if (!priceId) {
      throw new Error(`Invalid plan name: ${plan_name}. Available plans: ${Object.keys(PLAN_PRICES).join(', ')}`);
    }
    
    logStep("Plan validated", { plan_name, priceId });

    const stripeKey = env("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const dbAdmin = createClient(
      env("API_URL") ?? "",
      env("SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check if customer already exists
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId: string | undefined;
    
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing Stripe customer", { customerId });
    } else {
      // Create new customer
      const customer = await stripe.customers.create({
        email,
        name: full_name,
        metadata: {
          application_id,
          source: "registration",
        },
      });
      customerId = customer.id;
      logStep("Created new Stripe customer", { customerId });
    }

    const origin = req.headers.get("origin") || env("SITE_URL") || "https://matbex.com";

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${origin}/register?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/register?payment=canceled`,
      metadata: {
        application_id,
        plan_name,
        type: "registration",
      },
      subscription_data: {
        metadata: {
          application_id,
          plan_name,
        },
      },
    });

    logStep("Checkout session created", { sessionId: session.id });

    // Update application with stripe session ID
    const { error: updateError } = await dbAdmin
      .from("tenant_applications")
      .update({
        stripe_session_id: session.id,
        stripe_customer_id: customerId,
        payment_status: "pending",
      })
      .eq("id", application_id);

    if (updateError) {
      logStep("Warning: Failed to update application with session ID", { error: updateError.message });
    }

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
