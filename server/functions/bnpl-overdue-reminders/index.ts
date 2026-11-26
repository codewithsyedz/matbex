import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";

const APP_URL = "https://www.matbex.com";

function ymdRiyadh(d = new Date()): string {
  const shifted = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

interface Body {
  tenant_id?: string;
  date?: string;
  dryRun?: boolean;
}

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = await guardCronCaller(req, corsHeaders);
  if (unauthorized) return unauthorized;

  try {
    const db = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
    );

    const body: Body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const ymd = body.date ?? ymdRiyadh();
    const dryRun = !!body.dryRun;

    // Tenants with at least one overdue, unpaid installment
    let oq = db
      .from("installment_payments")
      .select("id, tenant_id, branch_id, plan_id, installment_no, due_date, amount, status, voided_at")
      .is("voided_at", null)
      .neq("status", "paid")
      .lt("due_date", ymd);
    if (body.tenant_id) oq = oq.eq("tenant_id", body.tenant_id);

    const { data: overdue, error: oErr } = await oq;
    if (oErr) throw oErr;

    const byTenant = new Map<string, any[]>();
    for (const row of overdue ?? []) {
      const arr = byTenant.get(row.tenant_id) ?? [];
      arr.push(row);
      byTenant.set(row.tenant_id, arr);
    }

    const results: any[] = [];

    for (const [tenantId, rows] of byTenant.entries()) {
      // Only active plans count
      const planIds = Array.from(new Set(rows.map((r) => r.plan_id)));
      const { data: plans } = await db
        .from("installment_plans")
        .select("id, provider, supplier_name, description, status")
        .in("id", planIds);
      const planMap = new Map<string, Record<string, any>>((plans ?? []).map((p: any) => [p.id, p]));
      const active = rows.filter((r) => planMap.get(r.plan_id)?.status === "active");
      if (active.length === 0) {
        results.push({ tenant: tenantId, skipped: "no-active-plans" });
        continue;
      }

      const total = active.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      const oldest = active.reduce((a, b) => (a.due_date < b.due_date ? a : b));
      const daysOverdue = Math.floor(
        (new Date(`${ymd}T00:00:00Z`).getTime() - new Date(`${oldest.due_date}T00:00:00Z`).getTime()) / 86400000,
      );

      // Recipients: owners, managers and accountants of the tenant
      const { data: tenantRestaurants } = await db
        .from("restaurants")
        .select("id")
        .eq("tenant_id", tenantId);
      const restaurantIds = (tenantRestaurants ?? []).map((r: any) => r.id);
      if (restaurantIds.length === 0) {
        results.push({ tenant: tenantId, skipped: "no-restaurants" });
        continue;
      }
      const { data: roles } = await db
        .from("user_roles")
        .select("user_id, role")
        .in("restaurant_id", restaurantIds)
        .in("role", ["owner", "manager", "accountant"]);
      const recipients = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
      if (recipients.length === 0) {
        results.push({ tenant: tenantId, skipped: "no-recipients" });
        continue;
      }

      // Idempotency: one reminder per user per day
      const { data: existing } = await db
        .from("in_app_notifications")
        .select("user_id, metadata")
        .eq("tenant_id", tenantId)
        .eq("action_type", "bnpl_overdue")
        .gte("created_at", `${ymd}T00:00:00+03:00`)
        .lt("created_at", `${ymd}T23:59:59+03:00`);
      const notified = new Set(
        (existing ?? []).filter((n: any) => n?.metadata?.ymd === ymd).map((n: any) => n.user_id),
      );
      const toNotify = recipients.filter((u) => !notified.has(u));
      if (toNotify.length === 0) {
        results.push({ tenant: tenantId, skipped: "already-notified" });
        continue;
      }

      const providers = Array.from(
        new Set(active.map((r) => planMap.get(r.plan_id)?.provider).filter(Boolean)),
      );

      const rowsToInsert = toNotify.map((user_id) => ({
        user_id,
        tenant_id: tenantId,
        title: `${active.length} BNPL installment${active.length === 1 ? "" : "s"} overdue`,
        message:
          `${active.length} installment${active.length === 1 ? " is" : "s are"} past due (${total.toFixed(2)} total)` +
          `${providers.length ? ` · ${providers.join(", ")}` : ""}. Oldest is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue.`,
        action_type: "bnpl_overdue",
        entity_type: "installment_payment",
        entity_id: oldest.id,
        metadata: {
          ymd,
          count: active.length,
          total_amount: total,
          oldest_due_date: oldest.due_date,
          days_overdue: daysOverdue,
          providers,
          deep_link: `${APP_URL}/accounting/bnpl-report`,
        },
      }));

      if (dryRun) {
        results.push({ tenant: tenantId, dryRun: true, would_notify: rowsToInsert.length, overdue: active.length });
        continue;
      }

      const { error: insErr } = await db.from("in_app_notifications").insert(rowsToInsert);
      if (insErr) {
        results.push({ tenant: tenantId, error: insErr.message });
        continue;
      }
      results.push({ tenant: tenantId, notified: rowsToInsert.length, overdue: active.length });
    }

    return new Response(JSON.stringify({ ok: true, ymd, tenants: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
