import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
/**
 * Daily ZATCA audit chain integrity check.
 * For every tenant with audit rows, re-runs verify_zatca_audit_chain server-side.
 * If a row fails verification, fans out an in-app notification to every owner
 * of every restaurant in that tenant.
 */
serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = await guardCronCaller(req, corsHeaders);
  if (unauthorized) return unauthorized;

  const db = createClient(
    env("API_URL")!,
    env("SERVICE_ROLE_KEY")!,
  );

  try {
    // Distinct tenants that have at least one audit row
    const { data: tenants, error: tErr } = await db
      .from("zatca_audit_trail")
      .select("tenant_id")
      .not("tenant_id", "is", null);
    if (tErr) throw tErr;

    const tenantIds = Array.from(new Set<string>((tenants ?? []).map((r: { tenant_id: string }) => r.tenant_id)));
    const summary: Array<{ tenant_id: string; intact: boolean; broken_seq: number | null; alerted: number }> = [];

    for (const tenantId of tenantIds) {
      const { data: chk, error: cErr } = await db.rpc("verify_zatca_audit_chain_admin", {
        _tenant_id: tenantId,
      });
      if (cErr) {
        console.error("verify failed", tenantId, cErr.message);
        summary.push({ tenant_id: tenantId, intact: false, broken_seq: null, alerted: 0 });
        continue;
      }
      const row = (chk ?? [])[0] as { broken_row: string | null; broken_seq: number | null; total_rows: number } | undefined;
      const intact = !row?.broken_row;

      if (intact) {
        summary.push({ tenant_id: tenantId, intact: true, broken_seq: null, alerted: 0 });
        continue;
      }

      // Fan out to owners of any restaurant in this tenant
      const { data: rests } = await db
        .from("restaurants")
        .select("id")
        .eq("tenant_id", tenantId);
      const restIds = (rests ?? []).map((r: { id: string }) => r.id);
      let owners: string[] = [];
      if (restIds.length) {
        const { data: roles } = await db
          .from("user_roles")
          .select("user_id")
          .eq("role", "owner")
          .in("restaurant_id", restIds);
        owners = Array.from(new Set((roles ?? []).map((r: { user_id: string }) => r.user_id)));
      }

      const today = new Date().toISOString().slice(0, 10);
      const notifications = owners.map((uid) => ({
        user_id: uid,
        tenant_id: tenantId,
        title: "ZATCA audit chain tampered",
        message: `Hash chain integrity check failed at sequence #${row?.broken_seq ?? "?"}. Investigate immediately on the Compliance dashboard.`,
        action_type: "ZATCA_CHAIN_TAMPERED",
        entity_type: "zatca_audit_trail",
        entity_id: row?.broken_row ?? null,
        metadata: { broken_seq: row?.broken_seq ?? null, check_date: today },
      }));

      let alerted = 0;
      if (notifications.length) {
        // Dedupe: skip if a notification for today already exists for this tenant
        const { data: existing } = await db
          .from("in_app_notifications")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .eq("action_type", "ZATCA_CHAIN_TAMPERED")
          .gte("created_at", `${today}T00:00:00Z`);
        const sentToday = new Set((existing ?? []).map((r: { user_id: string }) => r.user_id));
        const fresh = notifications.filter((n) => !sentToday.has(n.user_id));
        if (fresh.length) {
          const { error: insErr } = await db.from("in_app_notifications").insert(fresh);
          if (insErr) console.error("notify insert failed", tenantId, insErr.message);
          else alerted = fresh.length;
        }
      }

      summary.push({
        tenant_id: tenantId,
        intact: false,
        broken_seq: row?.broken_seq ?? null,
        alerted,
      });
    }

    return new Response(JSON.stringify({ ok: true, checked: tenantIds.length, summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});