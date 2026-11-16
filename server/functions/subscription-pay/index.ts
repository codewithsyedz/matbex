import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Matbex subscription and add-on payments through Matbex's Moyasar account (owners only).
//
// POST { action: "quote", plan_name, period }            -> price, what changes, add-ons included
// POST { action: "start", kind: "plan", plan_name, period } | { action: "start", kind: "addon", addon_id }
//                                                         -> { pay_url, payment_id }
// POST { action: "status", payment_id }                   -> { status } (after the redirect back)
//
// Amounts are computed here from plans / addons and the active branch count (subscriptionQuote);
// the account changes only in apply_subscription_payment, after Moyasar confirms the payment.

import { z } from "zod";
import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { paymentOwner } from "../_shared/subscriptionPayment.ts";
import { billedQuantity } from "../_shared/branchBillingPlan.ts";
import {
  addonRenewalAmount, quoteAddon, quotePlan, round2, withVat, MATBEX_VAT_RATE, type AccountState, type Period,
} from "../_shared/billing/subscriptionQuote.ts";
import { openPaymentPage, settleSubscriptionPayment, type SubscriptionPaymentRow } from "../_shared/billing/platformMoyasar.ts";

const Body = z.union([
  z.object({ action: z.literal("quote"), plan_name: z.string().min(1).max(40), period: z.enum(["month", "year"]) }),
  z.object({ action: z.literal("start"), kind: z.literal("plan"), plan_name: z.string().min(1).max(40), period: z.enum(["month", "year"]) }),
  z.object({ action: z.literal("start"), kind: z.literal("addon"), addon_id: z.string().uuid() }),
  // payment_id from our return URL, or invoice_id: Moyasar replaces the return URL's query string.
  z.object({ action: z.literal("status"), payment_id: z.string().uuid().optional(), invoice_id: z.string().uuid().optional() }),
]);

/** A reused pending payment page stays payable this long (Moyasar pages last 30 minutes). */
const REUSE_MINUTES = 25;

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  let owner;
  try {
    owner = await paymentOwner(admin, req);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Please sign in" }, 403);
  }
  const { user, tenant } = owner;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const body = parsed.data;

  // ---- account state ----------------------------------------------------------------
  const { data: t } = await admin.from("tenants").select("status, current_period_end, plan_id, plans:plan_id(name, price)")
    .eq("id", tenant.id).single();
  const plan = (t as any)?.plans as { name: string; price: number } | null;
  const account: AccountState = {
    plan: plan ? { name: plan.name, price: Number(plan.price) } : null,
    status: String(t?.status ?? ""),
    periodEnd: t?.current_period_end ? new Date(t.current_period_end) : null,
  };
  const branchCount = async () => {
    const { data: rest } = await admin.from("restaurants").select("id").eq("tenant_id", tenant.id);
    const ids = (rest ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return 1;
    const { count } = await admin.from("branches").select("id", { count: "exact", head: true })
      .in("restaurant_id", ids).is("deleted_at", null).neq("is_active", false);
    return billedQuantity(count ?? 0);
  };
  // Add-ons bought earlier (not admin grants) are renewed with the plan.
  const renewalAddons = async (period: Period) => {
    const { data } = await admin.from("tenant_addons").select("addon_id, addons:addon_id(name, price, is_active)")
      .eq("tenant_id", tenant.id).eq("source", "purchase").in("status", ["active", "expired"]);
    return (data ?? [])
      .filter((r: any) => r.addons?.is_active)
      .map((r: any) => ({ addon_id: r.addon_id as string, name: r.addons.name as string, amount: addonRenewalAmount(Number(r.addons.price), period) }));
  };

  const planQuote = async (planName: string, period: Period) => {
    const { data: target } = await admin.from("plans").select("id, name, price").eq("name", planName.toLowerCase()).eq("is_active", true).maybeSingle();
    if (!target) throw new Error("This plan is not available");
    const branches = await branchCount();
    const q = quotePlan(account, { name: target.name, price: Number(target.price) }, period, branches);
    const addons = q.mode === "upgrade" ? [] : await renewalAddons(period);
    const priced = withVat(q.amount + addons.reduce((s, a) => s + a.amount, 0));
    return { plan: target, branches, quote: q, addons, ...priced };
  };

  const returnUrl = (paymentId: string) => {
    const site = new URL(env("SITE_URL") ?? "https://matbex.com");
    const origin = req.headers.get("origin");
    let base = site.origin;
    if (origin) {
      try {
        const u = new URL(origin);
        const parent = site.hostname.split(".").slice(-2).join(".");
        if (u.protocol === "https:" && (u.hostname === parent || u.hostname.endsWith(`.${parent}`))) base = u.origin;
      } catch { /* keep SITE_URL */ }
    }
    return `${base}/billing?payment=${paymentId}`;
  };

  try {
    if (body.action === "quote") {
      const r = await planQuote(body.plan_name, body.period);
      return json({
        mode: r.quote.mode, months: r.quote.months, days_left: r.quote.daysLeft, branches: r.branches,
        plan_amount: r.quote.amount, addons: r.addons, subtotal: r.subtotal, vat: r.vat, vat_rate: MATBEX_VAT_RATE, total: r.total,
        current_period_end: account.periodEnd?.toISOString() ?? null,
      });
    }

    if (body.action === "status") {
      if (!body.payment_id && !body.invoice_id) return json({ error: "Missing payment reference" }, 400);
      let q = admin.from("subscription_payments").select("*").eq("tenant_id", tenant.id);
      q = body.payment_id ? q.eq("id", body.payment_id) : q.eq("moyasar_invoice_id", body.invoice_id!);
      const { data: row } = await q.maybeSingle();
      if (!row) return json({ error: "Payment not found" }, 404);
      const status = await settleSubscriptionPayment(row as SubscriptionPaymentRow);
      return json({ status });
    }

    // ---- start ----------------------------------------------------------------------
    let insert: Record<string, unknown>;
    let description: string;
    if (body.kind === "plan") {
      const r = await planQuote(body.plan_name, body.period);
      insert = {
        kind: "plan", mode: r.quote.mode, plan_id: r.plan.id, months: r.quote.months, branches: r.branches,
        subtotal: r.subtotal, vat_rate: MATBEX_VAT_RATE, vat_amount: r.vat, amount: r.total,
        addon_items: r.addons.map((a) => ({ addon_id: a.addon_id, amount: a.amount })),
      };
      const label = r.plan.name === "pro" ? "Growth" : r.plan.name[0].toUpperCase() + r.plan.name.slice(1);
      description = r.quote.mode === "upgrade"
        ? `Matbex upgrade to ${label} (${r.quote.daysLeft} days)`
        : `Matbex ${label}, ${r.quote.months === 12 ? "1 year" : "1 month"}, ${r.branches} branch${r.branches > 1 ? "es" : ""}`;
    } else {
      const { data: addon } = await admin.from("addons").select("id, name, price, is_active").eq("id", body.addon_id).maybeSingle();
      if (!addon?.is_active) return json({ error: "This add-on is not available" }, 404);
      const { data: owned } = await admin.from("tenant_addons").select("status, expires_at")
        .eq("tenant_id", tenant.id).eq("addon_id", addon.id).maybeSingle();
      if (owned?.status === "active" && (!owned.expires_at || new Date(owned.expires_at) > new Date())) {
        return json({ error: "You already have this add-on" }, 409);
      }
      const priced = withVat(quoteAddon(account, Number(addon.price)));
      insert = { kind: "addon", mode: "addon", addon_id: addon.id, subtotal: priced.subtotal, vat_rate: MATBEX_VAT_RATE, vat_amount: priced.vat, amount: priced.total };
      description = `Matbex add-on: ${addon.name}`;
    }

    // Reuse a recent unpaid page for exactly the same purchase.
    const { data: recent } = await admin.from("subscription_payments").select("*")
      .eq("tenant_id", tenant.id).eq("status", "pending").eq("kind", insert.kind as string)
      .gte("created_at", new Date(Date.now() - REUSE_MINUTES * 60_000).toISOString())
      .order("created_at", { ascending: false }).limit(5);
    const same = (recent ?? []).find((r: any) =>
      r.pay_url && Number(r.amount) === Number(insert.amount) && r.mode === insert.mode &&
      (r.plan_id ?? null) === (insert.plan_id ?? null) && (r.addon_id ?? null) === (insert.addon_id ?? null) &&
      r.months === (insert.months ?? 0));
    if (same) return json({ pay_url: same.pay_url, payment_id: same.id });

    const { data: row, error } = await admin.from("subscription_payments")
      .insert({ ...insert, tenant_id: tenant.id, created_by: user.id }).select("*").single();
    if (error || !row) throw new Error(error?.message ?? "Could not start the payment");
    try {
      const url = await openPaymentPage(row as SubscriptionPaymentRow, description, returnUrl(row.id));
      return json({ pay_url: url, payment_id: row.id });
    } catch (e) {
      await admin.from("subscription_payments").update({ status: "failed" }).eq("id", row.id);
      throw e;
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "The payment could not be started" }, 400);
  }
});
