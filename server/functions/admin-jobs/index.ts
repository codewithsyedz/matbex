import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// SuperAdmin job status (two-factor SuperAdmin sessions only). POST {} -> every scheduled job:
// schedule, whether it is on, next run, last run and result, last success and failure, runs and
// failures in 24 hours, and a health flag; plus the Deliverect status queue.
// Sources: schedules.ts (+ JOB_SCHEDULES_JSON), cron.job, public.job_runs (written by the scheduler).

import { Cron } from "croner";
import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/superadmin.ts";
import { DEFAULT_FUNCTION_SCHEDULES, JOBS_TIMEZONE } from "../../src/jobs/schedules.ts";

/** Plain-language names for the jobs people ask about; the rest show their technical name. */
const LABEL: Record<string, { label: string; about: string; featured?: boolean }> = {
  "subscription-renewals": { label: "Subscription renewals", about: "Renewal reminders 7/3/1 days before the paid-until date; past due after it", featured: true },
  "deliverect-status-sync": { label: "Deliverect status sync", about: "Sends order status changes to Deliverect, retrying until accepted", featured: true },
  "daily-pos-ledger-reconciliation": { label: "Day-end posting", about: "Posts each day's POS sales to the ledger and reconciles them", featured: true },
  "auto-close-shifts": { label: "Auto-close shifts", about: "Closes shifts left open past their end", featured: true },
  "trial-nurture": { label: "Trial emails", about: "Setup emails on trial days 1, 7 and 12", featured: true },
  "auto-shift-manager": { label: "Shift manager", about: "Opens and closes scheduled shifts" },
  "expire-trials-hourly": { label: "Expire trials", about: "Moves ended trials to the Free plan" },
  "zatca-clearance-worker": { label: "ZATCA clearance", about: "Sends invoices to ZATCA" },
  "zatca-device-monitor": { label: "ZATCA device monitor", about: "Checks device certificates" },
  "zatca-chain-integrity-check": { label: "ZATCA chain check", about: "Verifies the invoice hash chain" },
  "ledger-balance-check": { label: "Account balance check", about: "Corrects stored account balances to match the ledger" },
  "accountant-pending-alerts": { label: "Accountant alerts", about: "Emails accountants their pending work" },
  "sync-branch-billing": { label: "Branch billing sync", about: "Billed branches per business" },
  "run-cogs-trueup-schedules": { label: "COGS true-up", about: "Scheduled cost of goods true-ups" },
  "auto-monthly-depreciation": { label: "Monthly depreciation", about: "Posts fixed-asset depreciation" },
  "sweep-stale-impersonation-sessions": { label: "Impersonation sweep", about: "Ends stale support sessions" },
  "nightly-invoice-ledger-scan": { label: "Invoice ledger scan", about: "Nightly check of invoices against the ledger" },
};

type Health = "ok" | "failing" | "late" | "off" | "never";

function cadence(expr: string, tz: string) {
  try {
    const c = new Cron(expr, { timezone: tz, paused: true });
    const [a, b] = c.nextRuns(2);
    c.stop();
    return { next: a?.toISOString() ?? null, everyMs: a && b ? b.getTime() - a.getTime() : null };
  } catch {
    return { next: null, everyMs: null };
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
    const [cronRes, statsRes, cronLastRes, outbox] = await Promise.all([
      db.rpc("admin_cron_jobs"),
      db.rpc("admin_job_run_stats"),
      db.rpc("admin_cron_last_runs"),
      db.from("delivery_status_outbox").select("id, attempts, created_at, last_error").is("sent_at", null).order("created_at").limit(500),
    ]);
    if (cronRes.error) throw new Error(cronRes.error.message);
    if (statsRes.error) throw new Error(statsRes.error.message);
    // deno-lint-ignore no-explicit-any
    const cronJobs = (cronRes.data ?? []) as any[];
    // deno-lint-ignore no-explicit-any
    const stats = new Map(((statsRes.data ?? []) as any[]).map((s) => [s.job as string, s]));
    // deno-lint-ignore no-explicit-any
    const cronLast = new Map(((cronLastRes.data ?? []) as any[]).map((r) => [Number(r.jobid), r]));

    let overrides: Record<string, string | null> = {};
    try { overrides = env("JOB_SCHEDULES_JSON") ? JSON.parse(env("JOB_SCHEDULES_JSON")!) : {}; } catch { /* invalid JSON: defaults */ }
    const schedules = { ...DEFAULT_FUNCTION_SCHEDULES, ...overrides };
    const cronTargets = new Set(cronJobs.filter((j) => j.active && j.target_function).map((j) => j.target_function as string));
    const jobsOn = (env("JOBS_ENABLED") ?? "true") !== "false";
    const now = Date.now();

    const rows: Record<string, unknown>[] = [];
    const add = (key: string, source: string, schedule: string | null, tz: string, enabled: boolean, statKey: string, fallback?: { status: string; at: string; message: string | null }) => {
      const s = stats.get(statKey);
      const { next, everyMs } = enabled && schedule ? cadence(schedule, tz) : { next: null, everyMs: null };
      const lastAt = s?.last_started_at ?? fallback?.at ?? null;
      const lastStatus = s?.last_status ?? (fallback ? (fallback.status === "succeeded" ? "succeeded" : "failed") : null);
      let health: Health = "ok";
      if (!enabled || !jobsOn) health = "off";
      else if (!lastAt) health = "never";
      else if (lastStatus === "failed") health = "failing";
      else if (everyMs && now - new Date(lastAt).getTime() > Math.max(2 * everyMs, 5 * 60_000)) health = "late";
      const meta = LABEL[key];
      rows.push({
        key, label: meta?.label ?? key, about: meta?.about ?? null, featured: !!meta?.featured, source, schedule, timezone: tz,
        enabled: enabled && jobsOn, next_run: next, health,
        last_run: lastAt, last_status: lastStatus, last_http_status: s?.last_http_status ?? null,
        last_summary: s?.last_summary ?? fallback?.message ?? null, last_duration_ms: s?.last_duration_ms ?? null,
        last_success: s?.last_success_at ?? (fallback?.status === "succeeded" ? fallback.at : null),
        last_failure: s?.last_failure_at ?? null, last_failure_summary: s?.last_failure_summary ?? null,
        runs_24h: s?.runs_24h ?? 0, failures_24h: s?.failures_24h ?? 0,
      });
    };

    // Server-scheduled functions (unless a database cron job already calls them).
    for (const [fn, expr] of Object.entries(schedules)) {
      if (cronTargets.has(fn)) continue;
      add(fn, "server schedule", expr, JOBS_TIMEZONE, !!expr, fn);
    }
    // Database cron jobs: SQL ones under their name; those that call a function under the function.
    for (const j of cronJobs) {
      const last = cronLast.get(Number(j.jobid));
      const key = j.target_function ?? j.jobname ?? `cron-${j.jobid}`;
      if (j.target_function && !j.active && rows.some((r) => r.key === key)) continue;
      add(j.target_function ? key : (j.jobname ?? key), j.target_function ? `database cron · ${j.jobname}` : "database cron",
        j.schedule, "UTC", !!j.active, key,
        !j.target_function && last ? { status: last.status, at: last.start_time, message: last.return_message } : undefined);
    }
    const order: Record<Health, number> = { failing: 0, late: 1, never: 2, ok: 3, off: 4 };
    rows.sort((a, b) => Number(b.featured) - Number(a.featured) || order[a.health as Health] - order[b.health as Health] || String(a.label).localeCompare(String(b.label)));

    // deno-lint-ignore no-explicit-any
    const pending = (outbox.data ?? []) as any[];
    return json({
      generated_at: new Date().toISOString(),
      jobs_enabled: jobsOn,
      timezone: JOBS_TIMEZONE,
      jobs: rows,
      deliverect_queue: {
        pending: pending.length,
        retrying: pending.filter((p) => Number(p.attempts) > 0).length,
        oldest: pending[0]?.created_at ?? null,
        last_error: pending.find((p) => p.last_error)?.last_error ?? null,
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Job status failed" }, 500);
  }
});
