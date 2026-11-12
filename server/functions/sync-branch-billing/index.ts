import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import Stripe from "stripe";
import { createClient } from "@matbex/client";
import { guardCronCaller } from "../_shared/cronGuard.ts";
import { SUBSCRIPTION_PRICES } from "../_shared/subscriptionPayment.ts";
import { BRANCH_BILLED_PLANS, quantityChange } from "../_shared/branchBillingPlan.ts";

/**
 * Hourly (server/src/jobs/schedules.ts): keep each paid Starter/Growth subscription's quantity
 * equal to the business's active branches (at least 1), so "per branch per month" is what is
 * charged. Stripe prorates a change. Each change is written to audit_logs
 * (action branch_billing_quantity).
 *
 * Changes Stripe only when BRANCH_BILLING_ENABLED=true (production); otherwise it reports what
 * it would change. Without STRIPE_SECRET_KEY it does nothing. Staging holds real Stripe customer
 * ids copied from production: never enable it there.
 */
const ACTIVE = ["active", "past_due", "trialing"];

serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const denied = await guardCronCaller(req, {});
  if (denied) return denied;

  const key = env("STRIPE_SECRET_KEY");
  if (!key) return json({ status: "skipped", reason: "STRIPE_SECRET_KEY not set" });
  const apply = env("BRANCH_BILLING_ENABLED") === "true";
  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });
  const db = createClient(env("API_URL")!, env("SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const planPriceIds = Object.values(SUBSCRIPTION_PRICES).map((p) => p.id);

  const { data: tenants, error } = await db
    .from("tenants")
    .select("id, name, stripe_customer_id, plans!inner(name)")
    .eq("status", "active")
    .not("stripe_customer_id", "is", null)
    .in("plans.name", [...BRANCH_BILLED_PLANS]);
  if (error) return json({ error: error.message }, 500);

  const results: Record<string, unknown>[] = [];
  for (const t of tenants ?? []) {
    try {
      const { data: rest } = await db.from("restaurants").select("id").eq("tenant_id", t.id);
      const ids = (rest ?? []).map((r: { id: string }) => r.id);
      let branches = 0;
      if (ids.length) {
        const { count } = await db
          .from("branches")
          .select("id", { count: "exact", head: true })
          .in("restaurant_id", ids)
          .is("deleted_at", null)
          .neq("is_active", false);
        branches = count ?? 0;
      }

      const subs = await stripe.subscriptions.list({ customer: t.stripe_customer_id!, status: "all", limit: 20 });
      for (const sub of subs.data.filter((s) => ACTIVE.includes(s.status))) {
        const change = quantityChange(
          sub.items.data.map((i) => ({ id: i.id, priceId: i.price.id, quantity: i.quantity ?? 0 })),
          planPriceIds,
          branches,
        );
        if (!change) continue;
        const row = { tenant: t.name, subscription: sub.id, branches, from: change.from, to: change.to, applied: apply };
        if (apply) {
          await stripe.subscriptionItems.update(
            change.itemId,
            { quantity: change.to, proration_behavior: "create_prorations" },
            { idempotencyKey: `branch-qty-${change.itemId}-${change.to}-${new Date().toISOString().slice(0, 13)}` },
          );
          await db.from("audit_logs").insert({
            tenant_id: t.id,
            action: "branch_billing_quantity",
            entity_type: "stripe_subscription",
            entity_id: null,
            old_data: { subscription: sub.id, quantity: change.from },
            new_data: { subscription: sub.id, quantity: change.to, active_branches: branches },
          });
        }
        results.push(row);
      }
    } catch (e) {
      console.error("[sync-branch-billing]", t.id, e instanceof Error ? e.message : e);
      results.push({ tenant: t.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return json({ status: apply ? "applied" : "report_only", checked: tenants?.length ?? 0, changes: results });
});
