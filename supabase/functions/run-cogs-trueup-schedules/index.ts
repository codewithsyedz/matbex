import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauthorized = await guardCronCaller(req, corsHeaders);
  if (unauthorized) return unauthorized;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: due, error } = await supabase
    .from("cogs_trueup_schedules")
    .select("*")
    .eq("enabled", true)
    .lte("next_run_at", new Date().toISOString())
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];

  for (const sched of due ?? []) {
    try {
      // Find latest reconcilable stocktake
      const { data: stId, error: pickErr } = await supabase.rpc(
        "pick_latest_reconcilable_stocktake",
        { _restaurant_id: sched.restaurant_id, _kind: sched.stocktake_kind },
      );
      if (pickErr) throw pickErr;

      let runId: string | null = null;
      let status = "skipped";
      let summary = "No reconcilable stocktake available.";

      if (stId) {
        const { data: rid, error: recErr } = await supabase.rpc(
          "reconcile_provisional_cogs",
          {
            _stocktake_id: stId,
            _kind: sched.stocktake_kind,
            _correct_wac: sched.correct_wac,
            _reason: `Scheduled ${sched.frequency} run`,
          },
        );
        if (recErr) throw recErr;
        runId = rid as string;
        status = "completed";

        // Tag run with schedule + trigger
        await supabase.from("cogs_trueup_runs")
          .update({ triggered_by: "scheduled", schedule_id: sched.id })
          .eq("id", runId);

        const { data: runRow } = await supabase
          .from("cogs_trueup_runs").select("total_variance, items_with_variance, items_count")
          .eq("id", runId).single();
        if (runRow) {
          summary = `Variance ${Number(runRow.total_variance).toFixed(2)} across ${runRow.items_with_variance}/${runRow.items_count} items.`;
        }
      }

      // Notifications
      const recipients: string[] = (sched.notify_user_ids ?? []);
      if (recipients.length > 0) {
        const rows = recipients.map((uid) => ({
          user_id: uid,
          tenant_id: sched.tenant_id,
          title: stId ? "Scheduled COGS true-up complete" : "COGS true-up skipped",
          message: summary,
          action_type: "cogs_trueup",
          entity_type: "cogs_trueup_run",
          entity_id: runId,
          metadata: { schedule_id: sched.id, frequency: sched.frequency, stocktake_id: stId },
        }));
        await supabase.from("in_app_notifications").insert(rows);
      }

      // Mark schedule as run (triggers next_run_at recompute)
      await supabase.from("cogs_trueup_schedules").update({
        last_run_at: new Date().toISOString(),
        last_run_id: runId,
        last_status: status,
      }).eq("id", sched.id);

      if (runId) {
        await supabase.from("cogs_trueup_runs")
          .update({ notification_sent_at: new Date().toISOString() })
          .eq("id", runId);
      }

      results.push({ schedule_id: sched.id, status, run_id: runId });
    } catch (e: any) {
      await supabase.from("cogs_trueup_schedules").update({
        last_run_at: new Date().toISOString(),
        last_status: `error: ${e.message?.slice(0, 200) ?? "unknown"}`,
      }).eq("id", sched.id);
      results.push({ schedule_id: sched.id, status: "error", error: e.message });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});