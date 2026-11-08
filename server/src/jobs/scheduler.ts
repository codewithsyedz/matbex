/**
 * Background jobs (replaces pg_cron + pg_net + the hosted scheduler):
 *
 *  1. SQL jobs in cron.job (created by migrations via cron.schedule(), or
 *     imported with your production dump) run on their cron expression.
 *  2. net.http_post() calls are queued in net.http_request_queue and sent
 *     here. Calls to any ".../functions/v1/<name>" URL are dispatched to the
 *     in-process function, whatever host the URL names.
 *  3. Default schedules for scheduler-driven functions (schedules.ts) run
 *     unless a cron.job row already triggers that function.
 *
 * Only one API instance runs jobs at a time (Postgres advisory lock).
 */
import { Cron } from "croner";
import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { sql } from "../db.js";
import { invokeFunction } from "../functions/host.js";
import { DEFAULT_FUNCTION_SCHEDULES, JOBS_TIMEZONE } from "./schedules.js";

const LEADER_LOCK = 727_001;
const FN_URL = /\/functions\/v1\/([a-z0-9-]+)/i;

let log: FastifyBaseLogger;
const sqlJobs = new Map<number, { cron: Cron; schedule: string; command: string }>();
const fnJobs: Cron[] = [];

export async function startJobs(logger: FastifyBaseLogger) {
  log = logger.child({ mod: "jobs" });
  if (!config.JOBS_ENABLED) return log.info("jobs disabled (JOBS_ENABLED=false)");
  if (!process.env.CRON_SECRET) process.env.CRON_SECRET = randomBytes(24).toString("hex");

  const conn = await sql.reserve();
  const tryLead = async () => {
    const [{ ok }] = await conn`select pg_try_advisory_lock(${LEADER_LOCK}) as ok`;
    if (!ok) {
      setTimeout(tryLead, 30_000).unref();
      return;
    }
    log.info("this instance is the job leader");
    await reloadSqlJobs();
    setInterval(() => void reloadSqlJobs().catch((err) => log.error({ err }, "reload cron.job failed")), 60_000).unref();
    await scheduleFunctionDefaults();
    await sql.listen("net_http_request", () => void drainHttpQueue());
    setInterval(() => void drainHttpQueue(), 10_000).unref();
    void drainHttpQueue();
  };
  await tryLead();
}

async function reloadSqlJobs() {
  const rows = await sql<{ jobid: number; schedule: string; command: string; active: boolean; jobname: string | null }[]>`
    select jobid, schedule, command, active, jobname from cron.job`;
  const seen = new Set<number>();
  for (const r of rows) {
    if (!r.active) continue;
    seen.add(r.jobid);
    const existing = sqlJobs.get(r.jobid);
    if (existing && existing.schedule === r.schedule && existing.command === r.command) continue;
    existing?.cron.stop();
    try {
      const cron = new Cron(toCron(r.schedule), { timezone: "UTC", protect: true }, () => void runSqlJob(r.jobid, r.jobname, r.command));
      sqlJobs.set(r.jobid, { cron, schedule: r.schedule, command: r.command });
    } catch (err) {
      log.error({ err, job: r.jobname ?? r.jobid, schedule: r.schedule }, "invalid cron expression");
    }
  }
  for (const [id, j] of sqlJobs) {
    if (!seen.has(id)) {
      j.cron.stop();
      sqlJobs.delete(id);
    }
  }
}

/** pg_cron accepts "30 seconds"; croner wants a 6-field expression for that. */
function toCron(schedule: string) {
  const m = /^(\d+)\s+seconds?$/i.exec(schedule.trim());
  return m ? `*/${m[1]} * * * * *` : schedule;
}

async function runSqlJob(jobid: number, name: string | null, command: string) {
  const started = new Date();
  let status = "succeeded";
  let message = "";
  try {
    await sql.unsafe(command);
  } catch (err: any) {
    status = "failed";
    message = err?.message ?? String(err);
    log.error({ job: name ?? jobid, err: message }, "cron job failed");
  }
  await sql`
    insert into cron.job_run_details (jobid, status, return_message, start_time, end_time)
    values (${jobid}, ${status}, ${message}, ${started}, now())`.catch(() => undefined);
}

async function scheduleFunctionDefaults() {
  const overrides: Record<string, string | null> = config.JOB_SCHEDULES_JSON ? JSON.parse(config.JOB_SCHEDULES_JSON) : {};
  const schedules = { ...DEFAULT_FUNCTION_SCHEDULES, ...overrides };
  const rows = await sql<{ command: string }[]>`select command from cron.job where active`;
  const coveredByDb = new Set(rows.map((r) => FN_URL.exec(r.command)?.[1]).filter(Boolean) as string[]);

  for (const [fn, expr] of Object.entries(schedules)) {
    if (!expr || coveredByDb.has(fn)) continue;
    fnJobs.push(
      new Cron(expr, { timezone: JOBS_TIMEZONE, protect: true }, async () => {
        try {
          const res = await invokeFunction(fn, {
            headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET! },
            body: JSON.stringify({ source: "cron" }),
          });
          if (!res.ok) log.warn({ fn, status: res.status, body: (await res.text()).slice(0, 300) }, "scheduled function returned error");
        } catch (err) {
          log.error({ err, fn }, "scheduled function failed");
        }
      }),
    );
  }
  log.info({ functions: fnJobs.length, sqlJobs: sqlJobs.size }, "schedules active");
}

let draining = false;
async function drainHttpQueue() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const batch = await sql<{ id: number; method: string; url: string; headers: Record<string, string>; body: unknown; timeout_ms: number }[]>`
        update net.http_request_queue q set sent_at = now()
        where id in (select id from net.http_request_queue where sent_at is null order by id limit 20 for update skip locked)
        returning id, method, url, headers, body, timeout_ms`;
      if (!batch.length) break;
      await Promise.all(batch.map(sendQueued));
    }
  } finally {
    draining = false;
  }
}

async function sendQueued(r: { id: number; method: string; url: string; headers: Record<string, string>; body: unknown; timeout_ms: number }) {
  const body = r.body === null || r.body === undefined ? undefined : JSON.stringify(r.body);
  const headers = { ...(r.headers ?? {}) } as Record<string, string>;
  let status = 0;
  let error: string | null = null;
  try {
    const fn = FN_URL.exec(r.url)?.[1];
    if (fn) {
      // Legacy jobs authenticated with the hosted project's keys — use ours.
      headers["x-cron-secret"] = process.env.CRON_SECRET!;
      headers["authorization"] = `Bearer ${config.SERVICE_ROLE_KEY}`;
      delete headers["apikey"];
      const res = await invokeFunction(fn, { method: r.method, headers, body });
      status = res.status;
    } else {
      const res = await fetch(r.url, { method: r.method, headers, body, signal: AbortSignal.timeout(Math.max(r.timeout_ms, 30_000)) });
      status = res.status;
    }
  } catch (err: any) {
    error = err?.message ?? String(err);
  }
  await sql`update net.http_request_queue set status_code = ${status}, error = ${error} where id = ${r.id}`;
}

export function stopJobs() {
  sqlJobs.forEach((j) => j.cron.stop());
  fnJobs.forEach((c) => c.stop());
}
