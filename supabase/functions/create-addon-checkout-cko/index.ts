// Creates a Checkout.com Hosted Payments Page for an addon purchase.
// Mirrors create-addon-checkout but uses the Matbex *platform* Checkout.com
// account so tenants pay the platform (not their own merchant account).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { loadCkoPlatformCreds, ckoHost } from "../_shared/payments/ckoPlatform.ts";

const log = (step: string, details?: unknown) => {
  const s = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-ADDON-CHECKOUT-CKO] ${step}${s}`);
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const addonId: string | undefined = body.addon_id;
    if (!addonId) throw new Error("addon_id is required");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr) throw userErr;
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: roleRows, error: roleErr } = await admin
      .from("user_tenant_roles")
      .select("tenant_id, role")
      .eq("user_id", user.id);
    if (roleErr) throw roleErr;
    const ownerRow = (roleRows ?? []).find((r: any) => r.role === "owner");
    if (!ownerRow) throw new Error("Only owners can purchase addons");
    const tenantId = ownerRow.tenant_id;

    const { data: addon, error: addonErr } = await admin
      .from("addons")
      .select("*")
      .eq("id", addonId)
      .eq("is_active", true)
      .maybeSingle();
    if (addonErr) throw addonErr;
    if (!addon) throw new Error("Addon not found or inactive");

    const { data: existing } = await admin
      .from("tenant_addons")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("addon_id", addonId)
      .in("status", ["active", "pending"])
      .maybeSingle();
    if (existing && existing.status === "active") {
      throw new Error("Addon already active for this tenant");
    }

    const creds = await loadCkoPlatformCreds();
    if (!creds.secret_key) {
      throw new Error(
        "Checkout.com platform credentials not configured. Add them in Admin → Platform Settings.",
      );
    }
    const secretKey = creds.secret_key;
    const processingChannel = creds.processing_channel_id;

    const origin = req.headers.get("origin") ?? "https://www.matbex.com";
    const reference = `addon_${tenantId}_${addonId}_${Date.now()}`;
    const amountMinor = Math.round(Number(addon.price) * 100);

    const ckoBody: Record<string, unknown> = {
      amount: amountMinor,
      currency: (addon.currency ?? "SAR").toUpperCase(),
      reference,
      customer: { email: user.email },
      billing: { address: { country: "SA" } },
      success_url: `${origin}/billing?cko_addon_ref=${encodeURIComponent(reference)}&status=success`,
      failure_url: `${origin}/billing?cko_addon_ref=${encodeURIComponent(reference)}&status=failure`,
      cancel_url: `${origin}/billing?cko_addon_cancelled=true`,
      metadata: {
        purpose: "addon",
        tenant_id: tenantId,
        addon_id: addonId,
        addon_slug: addon.slug,
      },
    };
    if (processingChannel) ckoBody["processing_channel_id"] = processingChannel;

    const resp = await fetch(`${ckoHost(creds.environment)}/hosted-payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ckoBody),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      log("CKO error", data);
      throw new Error(
        `Checkout.com error: ${(data?.error_codes ?? []).join(", ") || data?.message || resp.status}`,
      );
    }
    const hostedId = data?.id;
    const redirectUrl = data?._links?.redirect?.href;
    if (!hostedId || !redirectUrl) {
      throw new Error("Checkout.com did not return a redirect URL");
    }
    log("Hosted payment created", { hostedId });

    if (existing) {
      await admin
        .from("tenant_addons")
        .update({
          status: "pending",
          provider: "checkout_com",
          source: "purchase",
          stripe_checkout_session_id: hostedId, // reuse column to store provider session id
        })
        .eq("id", existing.id);
    } else {
      await admin.from("tenant_addons").insert({
        tenant_id: tenantId,
        addon_id: addonId,
        status: "pending",
        source: "purchase",
        provider: "checkout_com",
        stripe_checkout_session_id: hostedId,
      });
    }

    return new Response(
      JSON.stringify({ url: redirectUrl, session_id: hostedId, reference }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ERROR", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});