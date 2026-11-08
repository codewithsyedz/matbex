// =====================================================================
// zatca-clearance-worker
// ---------------------------------------------------------------------
// Drains the background retry queue (`zatca_clearance_queue`):
//   1. Atomically claims up to N due jobs via `zatca_claim_clearance_jobs`
//      (FOR UPDATE SKIP LOCKED → safe under concurrent invocations).
//   2. For each job, invokes `zatca-submit-clearance` with the service-
//      role key so RLS doesn't get in the way.
//   3. On success → the submit function flips the sale to a terminal
//      state, the AFTER UPDATE trigger removes the queue row.
//   4. On failure → bumps `last_error` + `next_attempt_at` using
//      exponential backoff (1m, 2m, 4m, 8m… capped at 30m).
//
// Idempotency:
//   - Queue is keyed UNIQUE on sales_transaction_id, so re-enqueues
//     coalesce.
//   - The submit function early-returns when the sale is already
//     CLEARED/REPORTED, so duplicate runs are no-ops.
//   - `claim` increments attempts and sets `locked_until`, so a parallel
//     worker invocation won't pick the same row.
//
// Trigger by either: cron via supabase--insert (preferred, see comment
// at the bottom of this file) or a manual POST.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { buildCorsHeaders } from "../_shared/cors.ts";
function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function backoffSeconds(attempts: number): number {
  // 1m, 2m, 4m, 8m, 16m, then cap at 30m
  const base = Math.min(60 * Math.pow(2, Math.max(0, attempts - 1)), 30 * 60);
  // ±20% jitter
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ error: "Missing service config" }, 500, corsHeaders);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // Allow ?limit=N override (cron defaults to 25 per tick).
  const limit = (() => {
    try {
      const v = Number(new URL(req.url).searchParams.get("limit") ?? "25");
      return Number.isFinite(v) && v > 0 ? Math.min(v, 100) : 25;
    } catch { return 25; }
  })();

  // Atomic claim
  const { data: jobs, error: claimErr } = await admin.rpc(
    "zatca_claim_clearance_jobs",
    { _limit: limit, _lock_seconds: 90 },
  );
  if (claimErr) return json({ error: claimErr.message }, 500, corsHeaders);
  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, message: "No due jobs" }, 200, corsHeaders);
  }

  let succeeded = 0;
  let failed = 0;
  let exhausted = 0;

  for (const job of jobs as Array<{
    id: string; sales_transaction_id: string; attempts: number; max_attempts: number;
  }>) {
    try {
      const submitRes = await fetch(`${url}/functions/v1/zatca-submit-clearance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ sales_transaction_id: job.sales_transaction_id }),
      });
      const payload = await submitRes.json().catch(() => ({}));

      const status = (payload as { status?: string }).status ?? "";
      const ok = submitRes.ok && status !== "REJECTED";

      if (ok) {
        // Trigger removes the queue row when sale flips to CLEARED/etc.
        // Defensive cleanup in case the trigger missed (e.g. simulated).
        succeeded++;
        await admin.from("zatca_clearance_queue").delete().eq("id", job.id);
      } else {
        failed++;
        const errMsg = (payload as { error?: string }).error
          ?? `HTTP ${submitRes.status} - ${status || "REJECTED"}`;
        const nextAttempts = job.attempts; // already incremented by claim
        if (nextAttempts >= job.max_attempts) {
          exhausted++;
          await admin
            .from("zatca_clearance_queue")
            .update({
              last_error: `EXHAUSTED: ${errMsg}`,
              last_status: "REJECTED",
              locked_until: null,
              // Push next_attempt_at into the future so it stops being "due"
              next_attempt_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq("id", job.id);
        } else {
          await admin
            .from("zatca_clearance_queue")
            .update({
              last_error: errMsg,
              last_status: status || "REJECTED",
              locked_until: null,
              next_attempt_at: new Date(Date.now() + backoffSeconds(nextAttempts) * 1000).toISOString(),
            })
            .eq("id", job.id);
        }
      }
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      const nextAttempts = job.attempts;
      await admin
        .from("zatca_clearance_queue")
        .update({
          last_error: msg,
          last_status: "ERROR",
          locked_until: null,
          next_attempt_at: new Date(Date.now() + backoffSeconds(nextAttempts) * 1000).toISOString(),
        })
        .eq("id", job.id);
    }
  }

  return json({
    ok: true,
    claimed: jobs.length,
    succeeded,
    failed,
    exhausted,
  }, 200, corsHeaders);
});

// To run on a schedule, register a pg_cron job (see supabase--insert flow):
//   select cron.schedule(
//     'zatca-clearance-worker-tick',
//     '* * * * *',
//     $$ select net.http_post(
//          url := '<SUPABASE_URL>/functions/v1/zatca-clearance-worker',
//          headers := jsonb_build_object('Authorization', 'Bearer <ANON_KEY>')
//       ); $$
//   );