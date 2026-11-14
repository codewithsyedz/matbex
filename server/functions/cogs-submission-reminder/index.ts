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
  restaurant_id?: string; // optional: scope to a single restaurant (for manual test)
  date?: string;          // optional: override Riyadh-local YYYY-MM-DD
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

    // Active restaurants in scope
    let rq = db
      .from("restaurants")
      .select("id, name, tenant_id, status")
      .eq("status", "active");
    if (body.restaurant_id) rq = rq.eq("id", body.restaurant_id);
    const { data: restaurants, error: rErr } = await rq;
    if (rErr) throw rErr;

    const results: any[] = [];

    for (const r of restaurants ?? []) {
      // Check approved COGS submission for today (any shift_type counts)
      const { data: subs } = await db
        .from("daily_cogs_submissions")
        .select("id, status")
        .eq("restaurant_id", r.id)
        .eq("submission_date", ymd);

      const hasApproved = (subs ?? []).some((s: any) => s.status === "approved");
      if (hasApproved) {
        results.push({ restaurant: r.id, skipped: "already-submitted" });
        continue;
      }

      // Recipients: owners + managers
      const { data: roles } = await db
        .from("user_roles")
        .select("user_id, role")
        .eq("restaurant_id", r.id)
        .in("role", ["owner", "manager"]);

      const recipients = Array.from(new Set((roles ?? []).map((x: any) => x.user_id)));
      if (recipients.length === 0) {
        results.push({ restaurant: r.id, skipped: "no-recipients" });
        continue;
      }

      // Idempotency: skip users that already received today's reminder
      const { data: existing } = await db
        .from("in_app_notifications")
        .select("user_id, metadata")
        .eq("tenant_id", r.tenant_id)
        .eq("action_type", "cogs_reminder")
        .gte("created_at", `${ymd}T00:00:00+03:00`)
        .lt("created_at", `${ymd}T23:59:59+03:00`);

      const alreadyNotified = new Set(
        (existing ?? [])
          .filter((n: any) => n?.metadata?.restaurant_id === r.id && n?.metadata?.ymd === ymd)
          .map((n: any) => n.user_id),
      );
      const toNotify = recipients.filter((u) => !alreadyNotified.has(u));

      if (toNotify.length === 0) {
        results.push({ restaurant: r.id, skipped: "already-notified" });
        continue;
      }

      const hasDraft = (subs ?? []).some((s: any) => s.status !== "approved");
      const title = hasDraft
        ? "COGS submission pending approval"
        : "Submit today's COGS stocktake";
      const message = hasDraft
        ? `A draft stocktake for ${r.name} hasn't been approved yet. Tonight's WhatsApp P&L will use estimated COGS unless it's approved before 11 PM.`
        : `No stocktake submitted for ${r.name} today. Submit before 11 PM Riyadh so tonight's WhatsApp P&L shows real COGS.`;

      const rows = toNotify.map((user_id) => ({
        user_id,
        tenant_id: r.tenant_id,
        title,
        message,
        action_type: "cogs_reminder",
        entity_type: "daily_cogs_submission",
        metadata: {
          restaurant_id: r.id,
          restaurant_name: r.name,
          ymd,
          deep_link: `${APP_URL}/cockpit/stocktake`,
          has_draft: hasDraft,
        },
      }));

      if (dryRun) {
        results.push({ restaurant: r.id, dryRun: true, would_notify: rows.length });
        continue;
      }

      const { error: insErr } = await db.from("in_app_notifications").insert(rows);
      if (insErr) {
        results.push({ restaurant: r.id, error: insErr.message });
        continue;
      }
      results.push({ restaurant: r.id, notified: rows.length });
    }

    return new Response(JSON.stringify({ ok: true, ymd, count: results.length, results }), {
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