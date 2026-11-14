import { env } from "../_runtime/env.ts";
// Verifies a Checkout.com Hosted Payment for an addon and activates the
// tenant_addons row if the underlying payment is captured.

import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { loadCkoPlatformCreds, ckoHost } from "../_shared/payments/ckoPlatform.ts";

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const hostedId: string | undefined = body.session_id;
    if (!hostedId) throw new Error("session_id is required");

    const creds = await loadCkoPlatformCreds();
    if (!creds.secret_key) {
      throw new Error(
        "Checkout.com platform credentials not configured. Add them in Admin → Platform Settings.",
      );
    }
    const secretKey = creds.secret_key;
    const host = ckoHost(creds.environment);

    // 1. Fetch hosted payment
    const hpResp = await fetch(
      `${host}/hosted-payments/${hostedId}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    const hp = await hpResp.json().catch(() => ({}));
    if (!hpResp.ok) {
      throw new Error(hp?.message ?? `HTTP ${hpResp.status}`);
    }

    let status: string = hp?.status ?? "Pending";
    const paymentId: string | undefined = hp?.payment_id;
    if (paymentId) {
      const payResp = await fetch(`${host}/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const pay = await payResp.json().catch(() => ({}));
      if (payResp.ok) status = pay?.status ?? status;
    }

    const captured = ["Captured", "Paid", "Authorized"].includes(status);

    const admin = createClient(
      env("API_URL") ?? "",
      env("SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    if (captured) {
      await admin
        .from("tenant_addons")
        .update({
          status: "active",
          activated_at: new Date().toISOString(),
          stripe_subscription_id: paymentId ?? hostedId,
        })
        .eq("stripe_checkout_session_id", hostedId);
    }

    return new Response(
      JSON.stringify({ activated: captured, status, payment_id: paymentId }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});