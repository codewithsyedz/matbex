import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// SuperAdmin revenue dashboard (two-factor SuperAdmin sessions only). POST {} ->
//   kpis      MRR, ARR, paying businesses, average per business, this month's cash and refunds,
//             trials, past due, renewals due in 7 days, trial-to-paid conversion (last 90 days)
//   months    the last 12 months: MRR and its movement, new / churned businesses, cash, refunds
//   by_plan   MRR by plan; top     the 10 businesses paying the most
//   legacy    paid businesses still billed outside Matbex's payments (old Stripe accounts)
// Figures come from subscription_payments / subscription_refunds (see revenueMetrics.ts).

import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/superadmin.ts";
import { currentMrr, monthKey, monthlyRevenue, type PaymentIn, type RefundIn } from "../_shared/billing/revenueMetrics.ts";

const DAY = 24 * 3600 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// deno-lint-ignore no-explicit-any
async function all(q: () => any, page = 1000) {
  const out: unknown[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await q().range(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) return out;
  }
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    await requireSuperAdmin(req);
  } catch (e) {
    if (e instanceof Response) return new Response(await e.text(), { status: e.status, headers: { ...cors, "Content-Type": "application/json" } });
    return json({ error: "SuperAdmin access required" }, 403);
  }

  const db = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  try {
    const now = new Date();
    const [payRows, refundRows, tenants] = await Promise.all([
      all(() => db.from("subscription_payments")
        .select("id, tenant_id, kind, mode, months, amount, subtotal, refunded_amount, period_start, period_end, paid_at, plans:plan_id(name)")
        .eq("status", "paid").not("tenant_id", "is", null).order("paid_at")),
      all(() => db.from("subscription_refunds").select("payment_id, tenant_id, amount, vat_amount, ended_period, created_at").order("created_at")),
      all(() => db.from("tenants").select("id, name, status, billing_provider, current_period_end, trial_ends_at, created_at, plans:plan_id(name, price)")),
    ]);

    // deno-lint-ignore no-explicit-any
    const payments: PaymentIn[] = (payRows as any[]).map((p) => ({
      id: p.id, tenant_id: p.tenant_id, kind: p.kind, mode: p.mode, plan: p.plans?.name ?? null, months: Number(p.months) || 0,
      amount: Number(p.amount), subtotal: p.subtotal == null ? null : Number(p.subtotal), refunded_amount: Number(p.refunded_amount ?? 0),
      period_start: p.period_start, period_end: p.period_end, paid_at: p.paid_at,
    }));
    // deno-lint-ignore no-explicit-any
    const refunds: RefundIn[] = (refundRows as any[]).filter((r) => r.tenant_id).map((r) => ({
      payment_id: r.payment_id, tenant_id: r.tenant_id, amount: Number(r.amount), vat_amount: Number(r.vat_amount ?? 0),
      ended_period: !!r.ended_period, created_at: r.created_at,
    }));
    // deno-lint-ignore no-explicit-any
    const ts = tenants as any[];
    const byId = new Map(ts.map((t) => [t.id as string, t]));

    const months = monthlyRevenue(payments, refunds, now, 12);
    const cur = currentMrr(payments, refunds, now);
    const thisMonth = months[months.length - 1];
    const paidTenants = new Set(payments.map((p) => p.tenant_id));

    // Trial → paid: businesses created 90 to 14 days ago (their trial has had time to end).
    const cohort = ts.filter((t) => {
      const age = now.getTime() - new Date(t.created_at).getTime();
      return age >= 14 * DAY && age <= 90 * DAY;
    });
    const converted = cohort.filter((t) => paidTenants.has(t.id)).length;

    const moyasar = ts.filter((t) => t.billing_provider === "moyasar");
    const renewalsDue = moyasar.filter((t) => {
      if (!t.current_period_end || !["active", "past_due"].includes(t.status)) return false;
      const left = new Date(t.current_period_end).getTime() - now.getTime();
      return left >= 0 && left <= 7 * DAY;
    });
    const legacy = ts.filter((t) => t.billing_provider !== "moyasar" && t.status === "active" && Number(t.plans?.price ?? 0) > 0 && !paidTenants.has(t.id));

    return json({
      generated_at: now.toISOString(),
      current_month: monthKey(now),
      kpis: {
        mrr: cur.mrr,
        arr: round2(cur.mrr * 12),
        paying: cur.by_tenant.length,
        arpa: cur.by_tenant.length ? round2(cur.mrr / cur.by_tenant.length) : 0,
        cash_this_month: thisMonth.cash_collected,
        net_revenue_this_month: thisMonth.net_revenue,
        refunds_this_month: thisMonth.refunds,
        trials: ts.filter((t) => t.status === "trial").length,
        past_due: ts.filter((t) => t.status === "past_due").length,
        renewals_due_7d: renewalsDue.length,
        renewals_due_7d_value: round2(renewalsDue.reduce((s, t) => s + (cur.by_tenant.find((x) => x.tenant_id === t.id)?.mrr ?? 0), 0)),
        trial_cohort: cohort.length,
        trial_converted: converted,
      },
      months,
      by_plan: cur.by_plan,
      top: cur.by_tenant.slice(0, 10).map((x) => {
        const t = byId.get(x.tenant_id);
        return { tenant_id: x.tenant_id, name: t?.name ?? "—", plan: t?.plans?.name ?? null, status: t?.status ?? null, paid_until: t?.current_period_end ?? null, mrr: x.mrr };
      }),
      renewals_due: renewalsDue
        .sort((a, b) => String(a.current_period_end).localeCompare(String(b.current_period_end)))
        .slice(0, 10)
        .map((t) => ({ tenant_id: t.id, name: t.name, plan: t.plans?.name ?? null, paid_until: t.current_period_end, status: t.status })),
      legacy: { count: legacy.length, list_price_mrr: round2(legacy.reduce((s, t) => s + Number(t.plans?.price ?? 0), 0)) },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Revenue figures failed" }, 500);
  }
});
