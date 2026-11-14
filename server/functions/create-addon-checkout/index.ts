import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import Stripe from "stripe";
import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";

const log = (step: string, details?: unknown) => {
  const s = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-ADDON-CHECKOUT] ${step}${s}`);
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
      env("API_URL") ?? "",
      env("ANON_KEY") ?? ""
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr) throw userErr;
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated");
    log("User", { userId: user.id });

    const admin = createClient(
      env("API_URL") ?? "",
      env("SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Resolve tenant via user_tenant_roles (owner role required)
    const { data: roleRows, error: roleErr } = await admin
      .from("user_tenant_roles")
      .select("tenant_id, role")
      .eq("user_id", user.id);
    if (roleErr) throw roleErr;
    const ownerRow = (roleRows ?? []).find((r: any) => r.role === "owner");
    if (!ownerRow) throw new Error("Only owners can purchase addons");
    const tenantId = ownerRow.tenant_id;

    // Load addon
    const { data: addon, error: addonErr } = await admin
      .from("addons")
      .select("*")
      .eq("id", addonId)
      .eq("is_active", true)
      .maybeSingle();
    if (addonErr) throw addonErr;
    if (!addon) throw new Error("Addon not found or inactive");
    if (!addon.stripe_price_id) throw new Error("This addon is not available for self-serve checkout");

    // Prevent duplicate active/pending entitlement
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

    const stripeKey = env("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) customerId = customers.data[0].id;

    const origin = req.headers.get("origin") ?? "https://www.matbex.com";
    const mode = addon.billing_type === "recurring" ? "subscription" : "payment";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: addon.stripe_price_id, quantity: 1 }],
      mode,
      success_url: `${origin}/billing?addon_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing?addon_cancelled=true`,
      metadata: {
        tenant_id: tenantId,
        addon_id: addonId,
        addon_slug: addon.slug,
      },
    });
    log("Session created", { sessionId: session.id });

    // Upsert pending tenant_addon row
    if (existing) {
      await admin
        .from("tenant_addons")
        .update({
          status: "pending",
          stripe_checkout_session_id: session.id,
          source: "purchase",
        })
        .eq("id", existing.id);
    } else {
      await admin.from("tenant_addons").insert({
        tenant_id: tenantId,
        addon_id: addonId,
        status: "pending",
        source: "purchase",
        stripe_checkout_session_id: session.id,
      });
    }

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
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
