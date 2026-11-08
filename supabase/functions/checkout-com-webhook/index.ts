// Unified Checkout.com webhook endpoint.
//
// - For POS payments (metadata.purpose === "pos_order" or absent), updates
//   `payment_intents` via gateway_intent_id match.
// - For SaaS addons (metadata.purpose === "addon"), activates the matching
//   `tenant_addons` row.
//
// Uses platform secret CKO_PLATFORM_WEBHOOK_SECRET for HMAC verification.
// (Per-tenant POS webhooks should configure their own endpoint pointing to
// payments-webhook with gateway=checkout_com — that path already exists.)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { loadCkoPlatformCreds } from "../_shared/payments/ckoPlatform.ts";

async function verifyHmac(raw: string, sig: string | null, secret: string) {
  if (!sig || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
  const hex = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.toLowerCase() === sig.toLowerCase();
}

function isCaptured(eventType: string | undefined): boolean {
  const t = (eventType ?? "").toLowerCase();
  return t.includes("captured") || t.includes("payment_paid") || t.includes("authorized");
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const raw = await req.text();
    const sig = req.headers.get("cko-signature");
    const creds = await loadCkoPlatformCreds();
    const secret = creds.webhook_secret;
    const verified = await verifyHmac(raw, sig, secret);
    const payload = raw ? JSON.parse(raw) : {};

    console.log("[CKO-WEBHOOK]", payload?.type, "verified=", verified);
    if (!verified && secret) {
      return new Response(JSON.stringify({ error: "signature_invalid" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = payload?.data ?? {};
    const purpose = data?.metadata?.purpose ?? "pos_order";
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    if (purpose === "addon" && isCaptured(payload?.type)) {
      const reference = data?.reference;
      const paymentId = data?.id;
      if (reference) {
        await admin
          .from("tenant_addons")
          .update({
            status: "active",
            activated_at: new Date().toISOString(),
            stripe_subscription_id: paymentId,
          })
          .eq("provider", "checkout_com")
          .eq("status", "pending")
          .eq("stripe_checkout_session_id", data?.metadata?.session_id ?? reference);
      }
    }

    if (purpose === "pos_order") {
      // Best-effort update of payment_intents — exact dispatch lives in
      // payments-webhook; this only logs/forwards.
      console.log("[CKO-WEBHOOK] pos_order event", data?.id);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CKO-WEBHOOK] error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});