// =====================================================================
// stripe-webhook - verified Stripe event handler
// ---------------------------------------------------------------------
// Webhook authenticity is enforced via HMAC signature verification
// using STRIPE_WEBHOOK_SECRET. Never trust the body otherwise.
//
// Handles:
//   - checkout.session.completed          → mark tenant active, set plan
//   - customer.subscription.updated       → sync status / period end
//   - customer.subscription.deleted       → mark tenant canceled
//   - invoice.payment_failed              → mark tenant past_due
//
// Config: this function MUST keep verify_jwt = false (Stripe doesn't
// send Supabase JWTs). Authentication is the HMAC signature.
// =====================================================================

import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2025-08-27.basil" });

function log(step: string, data?: unknown) {
  console.log(`[stripe-webhook] ${step}`, data ? JSON.stringify(data) : "");
}

async function findTenantByCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabase
    .from("tenants")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

function mapSubscriptionStatus(s: string): string {
  // Map Stripe subscription status → tenant status.
  switch (s) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return s;
  }
}

/**
 * Auto-provision a public subdomain ({slug}.matbex.com) if the tenant's
 * current plan has the `public_subdomain` feature flag enabled. Idempotent —
 * safe to call on every subscription event; the SQL function no-ops when a
 * subdomain already exists.
 */
async function maybeProvisionSubdomain(tenantId: string): Promise<void> {
  try {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("plan_id")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant?.plan_id) {
      log("provision skipped: no plan_id", { tenantId });
      return;
    }
    const { data: plan } = await supabase
      .from("plans")
      .select("default_feature_flags")
      .eq("id", tenant.plan_id)
      .maybeSingle();
    const flags = (plan?.default_feature_flags ?? {}) as Record<string, unknown>;
    if (flags.public_subdomain !== true) {
      log("provision skipped: flag off", { tenantId });
      return;
    }
    const { data: subdomain, error } = await supabase.rpc(
      "provision_tenant_subdomain",
      { _tenant_id: tenantId },
    );
    if (error) {
      console.error("[stripe-webhook] provision error", error);
      return;
    }
    log("subdomain provisioned", { tenantId, subdomain });
  } catch (err) {
    console.error("[stripe-webhook] provision exception", err);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!WEBHOOK_SECRET) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return new Response("Webhook not configured", { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const rawBody = await req.text();

  // Stripe SDK supports async verification (required in Deno because
  // SubtleCrypto is the only HMAC primitive available).
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      WEBHOOK_SECRET,
    );
  } catch (err) {
    console.warn("[stripe-webhook] signature verification failed", (err as Error).message);
    return new Response(`Invalid signature: ${(err as Error).message}`, { status: 400 });
  }

  log("event", { id: event.id, type: event.type });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const tenantId = (session.metadata?.tenant_id as string | undefined) ??
          (customerId ? await findTenantByCustomer(customerId) : null);
        if (!tenantId) {
          log("checkout: no tenant found", { customerId });
          break;
        }
        await supabase.from("tenants").update({
          status: "active",
          stripe_customer_id: customerId ?? undefined,
          trial_ends_at: null,
        }).eq("id", tenantId);
        log("checkout: tenant activated", { tenantId });
        await maybeProvisionSubdomain(tenantId);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const tenantId = await findTenantByCustomer(customerId);
        if (!tenantId) {
          log("sub.updated: no tenant", { customerId });
          break;
        }
        const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
        await supabase.from("tenants").update({
          status: mapSubscriptionStatus(sub.status),
          current_period_end: periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
        }).eq("id", tenantId);
        log("sub synced", { tenantId, status: sub.status });
        if (sub.status === "active" || sub.status === "trialing") {
          await maybeProvisionSubdomain(tenantId);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const tenantId = await findTenantByCustomer(customerId);
        if (!tenantId) break;
        await supabase.from("tenants").update({
          status: "canceled",
        }).eq("id", tenantId);
        log("sub canceled", { tenantId });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (!customerId) break;
        const tenantId = await findTenantByCustomer(customerId);
        if (!tenantId) break;
        await supabase.from("tenants").update({
          status: "past_due",
        }).eq("id", tenantId);
        log("invoice failed → past_due", { tenantId });
        break;
      }

      default:
        log("ignored event", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[stripe-webhook] handler error", err);
    // Return 200 so Stripe doesn't retry forever on data issues we can't recover from.
    return new Response(JSON.stringify({ received: true, error: (err as Error).message }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});