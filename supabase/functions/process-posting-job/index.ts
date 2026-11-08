// Background processor for posting_jobs.
//
// Resumability: each invocation processes the slice of the job's expense_ids
// that comes after `processed`. If the function dies mid-run, the job row
// retains its counters so a subsequent invocation picks up exactly where it
// stopped (called by client retry, a cron, or another worker).
//
// On terminal status (`completed`, `failed`, `cancelled`) the worker inserts
// a row in `in_app_notifications` so the user is notified in-app.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { buildCorsHeaders, corsPreflight } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MAX_PER_INVOCATION = 200; // hard cap per HTTP call; resumable beyond

interface BodyShape {
  job_id: string;
  max?: number;
}

serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  const cors = buildCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401, cors);
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401, cors);

    const body = (await req.json().catch(() => ({}))) as BodyShape;
    if (!body?.job_id) return json({ error: "job_id required" }, 400, cors);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Load the job and verify the user belongs to the tenant.
    const { data: job, error: jobErr } = await admin
      .from("posting_jobs")
      .select("*")
      .eq("id", body.job_id)
      .single();
    if (jobErr || !job) return json({ error: "Job not found" }, 404, cors);

    const { data: membership } = await admin
      .from("user_tenant_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("tenant_id", job.tenant_id);
    const roles = (membership ?? []).map((m: any) => m.role);
    const canRun = roles.some((r) => ["owner", "manager", "accountant"].includes(r));
    if (!canRun) return json({ error: "Forbidden" }, 403, cors);

    if (["completed", "failed", "cancelled"].includes(job.status)) {
      return json({ status: job.status, message: "Job already finished" }, 200, cors);
    }

    // Mark running on first pickup.
    if (job.status === "queued") {
      await admin
        .from("posting_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", job.id);
    }

    const ids: string[] = Array.isArray(job.expense_ids) ? job.expense_ids : [];
    const sliceStart = Number(job.processed ?? 0);
    const sliceEnd = Math.min(ids.length, sliceStart + Math.min(MAX_PER_INVOCATION, body.max ?? MAX_PER_INVOCATION));
    const slice = ids.slice(sliceStart, sliceEnd);

    // Carry the caller's JWT so SECURITY DEFINER role checks inside the
    // posting RPCs still see the original user (they read auth.uid()).
    const runner = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    let posted = job.posted ?? 0;
    let skipped = job.skipped ?? 0;
    let failed = job.failed ?? 0;
    let fixed = job.fixed ?? 0;
    let manualReview = job.manual_review ?? 0;
    let processed = sliceStart;
    const details: any[] = Array.isArray(job.details) ? job.details.slice() : [];
    let lastError: string | null = job.last_error ?? null;

    for (const expenseId of slice) {
      await admin
        .from("posting_jobs")
        .update({ current_expense_id: expenseId })
        .eq("id", job.id);

      try {
        if (job.job_type === "bulk_post") {
          const { data, error } = await runner.rpc("post_single_expense", {
            p_expense_id: expenseId,
          });
          if (error) {
            failed++;
            lastError = error.message;
            details.push({ expense_id: expenseId, outcome: "failed", error: error.message });
          } else {
            const out = (data as any)?.outcome ?? "failed";
            if (out === "posted") posted++;
            else if (out === "blocked") skipped++;
            else failed++;
            details.push({ expense_id: expenseId, ...data });
          }
        } else {
          const { data, error } = await runner.rpc("auto_reconcile_single_expense", {
            p_expense_id: expenseId,
          });
          if (error) {
            failed++;
            lastError = error.message;
            details.push({ expense_id: expenseId, outcome: "failed", error: error.message });
          } else {
            const out = (data as any)?.outcome ?? "failed";
            if (out === "fixed") fixed++;
            else if (out === "needs_manual_review") manualReview++;
            else if (out === "already_balanced") skipped++;
            else failed++;
            details.push({ expense_id: expenseId, ...data });
          }
        }
      } catch (e: any) {
        failed++;
        lastError = e?.message ?? String(e);
        details.push({ expense_id: expenseId, outcome: "failed", error: lastError });
      }
      processed++;

      // Checkpoint every step so resumption is exact.
      await admin
        .from("posting_jobs")
        .update({
          processed,
          posted,
          skipped,
          failed,
          fixed,
          manual_review: manualReview,
          last_error: lastError,
          details: details.slice(-500),
        })
        .eq("id", job.id);
    }

    const isDone = processed >= ids.length;
    if (isDone) {
      const finalStatus = failed > 0 && posted + fixed + skipped + manualReview === 0
        ? "failed"
        : "completed";
      await admin
        .from("posting_jobs")
        .update({
          status: finalStatus,
          completed_at: new Date().toISOString(),
          current_expense_id: null,
        })
        .eq("id", job.id);

      // In-app notification.
      const title = job.job_type === "bulk_post"
        ? "Bulk posting finished"
        : "Auto-reconcile finished";
      const msg = job.job_type === "bulk_post"
        ? `${posted} posted · ${skipped} skipped · ${failed} failed`
        : `${fixed} fixed · ${manualReview} need review · ${failed} failed`;

      await admin.from("in_app_notifications").insert({
        tenant_id: job.tenant_id,
        user_id: job.created_by ?? user.id,
        title,
        message: msg,
        action_type: "posting_job_completed",
        entity_type: "posting_job",
        entity_id: job.id,
        metadata: {
          job_type: job.job_type,
          branch_id: job.branch_id,
          posted, skipped, failed, fixed, manual_review: manualReview,
          total: ids.length,
          status: finalStatus,
        },
      });
    }

    return json({
      job_id: job.id,
      status: isDone ? "completed" : "running",
      processed,
      total: ids.length,
      remaining: ids.length - processed,
      posted, skipped, failed, fixed, manual_review: manualReview,
    }, 200, cors);
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, 500, cors);
  }
});

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}