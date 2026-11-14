/**
 * Background jobs on BullMQ + Redis (used when REDIS_URL is set; otherwise scheduler.ts
 * runs the same work in-process).
 *
 *   schedules  repeatable triggers: cron.job SQL jobs and the default function schedules
 *              (schedules.ts). BullMQ job schedulers fire each tick once across all workers,
 *              so any number of worker replicas can run.
 *   http       net.http_post() deliveries from net.http_request_queue. Calls to external
 *              URLs are retried with backoff; in-process function calls are not retried
 *              (they may have side effects such as sending email).
 *   tasks      general background work for new modules (notifications, reports, ...).
 *
 * The worker re-syncs schedules from cron.job every minute, so schedules created by
 * migrations or SQL (cron.schedule / cron.unschedule) are picked up without a restart.
 */
import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { randomBytes } from "node:crypto";
import client from "prom-client";
import { config } from "../config.js";
import { sql } from "../db.js";
import { invokeFunction } from "../functions/host.js";
import { httpQueueDeliveries, jobRuns, registry, statusClass } from "../lib/metrics.js";
import { DEFAULT_FUNCTION_SCHEDULES, JOBS_TIMEZONE } from "./schedules.js";

const FN_URL = /\/functions\/v1\/([a-z0-9-]+)/i;
const PREFIX = `${config.REDIS_KEY_PREFIX.replace(/:+$/, "")}:bull`;

type ScheduleData = { kind: "sql"; jobid: number; name: string | null } | { kind: "function"; fn: string };
type HttpRow = { id: number; method: string; url: string; headers: Record<string, string>; body: unknown; timeout_ms: number };

let log: FastifyBaseLogger;
const workers: Worker[] = [];
const queues: Queue[] = [];
const timers: NodeJS.Timeout[] = [];

function connection(): ConnectionOptions {
  // BullMQ opens its own connections (blocking reads need maxRetriesPerRequest: null and no
  // keyPrefix), separate from the shared cache client in lib/redis.ts.
  return { url: config.REDIS_URL!, maxRetriesPerRequest: null };
}

export function queueFor(name: "schedules" | "http" | "tasks") {
  const q = new Queue(name, { connection: connection(), prefix: PREFIX });
  queues.push(q);
  return q;
}

/** pg_cron accepts "30 seconds"; BullMQ takes that as an interval. */
function repeatFor(schedule: string, tz: string) {
  const m = /^(\d+)\s+seconds?$/i.exec(schedule.trim());
  return m ? { every: Number(m[1]) * 1000 } : { pattern: schedule, tz };
}

// ---------------------------------------------------------------- schedules
async function syncSchedules(q: Queue) {
  const rows = await sql<{ jobid: number; schedule: string; jobname: string | null; command: string; active: boolean }[]>`
    select jobid, schedule, jobname, command, active from cron.job`;
  const overrides: Record<string, string | null> = config.JOB_SCHEDULES_JSON ? JSON.parse(config.JOB_SCHEDULES_JSON) : {};
  const fnSchedules = { ...DEFAULT_FUNCTION_SCHEDULES, ...overrides };
  // A function already triggered by a cron.job row is not scheduled twice.
  const coveredByDb = new Set(rows.filter((r) => r.active).map((r) => FN_URL.exec(r.command)?.[1]).filter(Boolean) as string[]);

  const wanted = new Map<string, { repeat: ReturnType<typeof repeatFor>; data: ScheduleData }>();
  for (const r of rows) {
    if (!r.active) continue;
    wanted.set(`sql:${r.jobid}`, { repeat: repeatFor(r.schedule, "UTC"), data: { kind: "sql", jobid: r.jobid, name: r.jobname } });
  }
  for (const [fn, expr] of Object.entries(fnSchedules)) {
    if (!expr || coveredByDb.has(fn)) continue;
    wanted.set(`fn:${fn}`, { repeat: repeatFor(expr, JOBS_TIMEZONE), data: { kind: "function", fn } });
  }

  // Only touch schedulers whose definition changed: re-upserting an unchanged scheduler
  // every minute can drop the tick that is due at that moment.
  const existing = new Map<string, { pattern?: string | null; tz?: string | null; every?: number | string | null }>();
  for (const s of await q.getJobSchedulers(0, -1)) {
    const key = s.key ?? s.id;
    if (key) existing.set(key, s as any);
  }
  for (const [id, w] of wanted) {
    const cur = existing.get(id);
    const same =
      cur &&
      ("every" in w.repeat
        ? Number(cur.every) === w.repeat.every
        : cur.pattern === w.repeat.pattern && (cur.tz ?? "UTC") === w.repeat.tz);
    if (same) continue;
    try {
      await q.upsertJobScheduler(id, w.repeat, { name: w.data.kind, data: w.data, opts: { removeOnComplete: 1000, removeOnFail: 5000 } });
      log.info({ scheduler: id, repeat: w.repeat }, cur ? "schedule updated" : "schedule added");
    } catch (err) {
      log.error({ err: (err as Error).message, scheduler: id, repeat: w.repeat }, "invalid schedule");
    }
  }
  for (const key of existing.keys()) {
    if (!wanted.has(key)) {
      await q.removeJobScheduler(key);
      log.info({ scheduler: key }, "schedule removed");
    }
  }
  return wanted.size;
}

async function runSchedule(job: Job<ScheduleData>) {
  const d = job.data;
  if (d.kind === "sql") {
    // Read the command at run time so edits to cron.job apply immediately.
    const [row] = await sql<{ command: string; active: boolean }[]>`select command, active from cron.job where jobid = ${d.jobid}`;
    if (!row?.active) return "skipped (inactive or removed)";
    const started = new Date();
    let status = "succeeded";
    let message = "";
    try {
      await sql.unsafe(row.command);
    } catch (err: any) {
      status = "failed";
      message = err?.message ?? String(err);
    }
    jobRuns.inc({ job: d.name ?? `job-${d.jobid}`, kind: "sql", result: status });
    await sql`
      insert into cron.job_run_details (jobid, status, return_message, start_time, end_time)
      values (${d.jobid}, ${status}, ${message}, ${started}, now())`.catch(() => undefined);
    if (status === "failed") throw new Error(message);
    return status;
  }
  const res = await invokeFunction(d.fn, {
    headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET! },
    body: JSON.stringify({ source: "cron" }),
  });
  jobRuns.inc({ job: d.fn, kind: "function", result: res.ok ? "succeeded" : "failed" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return `HTTP ${res.status}`;
}

// ---------------------------------------------------------------- net.http queue
let claiming = false;
async function claimHttpRows(q: Queue) {
  if (claiming) return;
  claiming = true;
  try {
    for (;;) {
      const batch = await sql<HttpRow[]>`
        update net.http_request_queue q set sent_at = now()
        where id in (select id from net.http_request_queue where sent_at is null order by id limit 50 for update skip locked)
        returning id, method, url, headers, body, timeout_ms`;
      if (!batch.length) break;
      await q.addBulk(
        batch.map((r) => {
          const internal = FN_URL.test(r.url);
          return {
            name: internal ? "function" : "external",
            data: r,
            opts: {
              jobId: `http-${r.id}`,
              attempts: internal ? 1 : 4,
              backoff: { type: "exponential", delay: 5_000 },
              removeOnComplete: 1000,
              removeOnFail: 5000,
            },
          };
        }),
      );
    }
  } finally {
    claiming = false;
  }
}

async function deliver(job: Job<HttpRow>) {
  const r = job.data;
  const body = r.body === null || r.body === undefined ? undefined : JSON.stringify(r.body);
  const headers = { ...(r.headers ?? {}) } as Record<string, string>;
  let status = 0;
  let error: string | null = null;
  const fn = FN_URL.exec(r.url)?.[1];
  try {
    if (fn) {
      // Legacy jobs authenticated with the hosted project's keys: use ours.
      headers["x-cron-secret"] = process.env.CRON_SECRET!;
      headers["authorization"] = `Bearer ${config.SERVICE_ROLE_KEY}`;
      delete headers["apikey"];
      status = (await invokeFunction(fn, { method: r.method, headers, body })).status;
    } else {
      const res = await fetch(r.url, { method: r.method, headers, body, signal: AbortSignal.timeout(Math.max(r.timeout_ms, 30_000)) });
      status = res.status;
    }
  } catch (err: any) {
    error = err?.message ?? String(err);
  }
  const retryable = !fn && (error !== null || status >= 500 || status === 429);
  const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  if (!retryable || lastAttempt) {
    httpQueueDeliveries.inc({ status: error ? "error" : statusClass(status) });
    await sql`update net.http_request_queue set status_code = ${status}, error = ${error} where id = ${r.id}`;
  }
  if (retryable) throw new Error(error ?? `HTTP ${status}`);
  return status;
}

// ---------------------------------------------------------------- lifecycle
export async function startQueueJobs(logger: FastifyBaseLogger) {
  log = logger.child({ mod: "jobs" });
  if (!config.REDIS_URL) throw new Error("BullMQ jobs need REDIS_URL");
  if (!process.env.CRON_SECRET) process.env.CRON_SECRET = randomBytes(24).toString("hex");

  const schedules = queueFor("schedules");
  const http = queueFor("http");
  queueFor("tasks");

  const onFailed = (queue: string) => (job: Job | undefined, err: Error) =>
    log.warn({ queue, job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: err.message }, "job failed");

  const schedWorker = new Worker<ScheduleData>("schedules", runSchedule, {
    connection: connection(),
    prefix: PREFIX,
    concurrency: config.JOBS_CONCURRENCY,
    // Scheduled functions can run for minutes (reports, reconciliation).
    lockDuration: 10 * 60_000,
  });
  schedWorker.on("failed", onFailed("schedules"));
  const httpWorker = new Worker<HttpRow>("http", deliver, { connection: connection(), prefix: PREFIX, concurrency: 10 });
  httpWorker.on("failed", onFailed("http"));
  workers.push(schedWorker, httpWorker);

  const count = await syncSchedules(schedules);
  log.info({ schedules: count, prefix: PREFIX }, "BullMQ workers started");
  timers.push(setInterval(() => void syncSchedules(schedules).catch((err) => log.error({ err }, "schedule sync failed")), 60_000));

  await sql.listen("net_http_request", () => void claimHttpRows(http).catch((err) => log.error({ err }, "http claim failed")));
  timers.push(setInterval(() => void claimHttpRows(http).catch((err) => log.error({ err }, "http claim failed")), 10_000));
  void claimHttpRows(http);

  registerQueueMetrics([schedules, http]);
}

function registerQueueMetrics(qs: Queue[]) {
  if (registry.getSingleMetric("matbex_queue_jobs")) return;
  new client.Gauge({
    name: "matbex_queue_jobs",
    help: "BullMQ jobs by queue and state",
    labelNames: ["queue", "state"] as const,
    registers: [registry],
    async collect() {
      for (const q of qs) {
        const counts = await q.getJobCounts("waiting", "active", "delayed", "failed", "completed").catch(() => null);
        if (!counts) continue;
        for (const [state, n] of Object.entries(counts)) this.set({ queue: q.name, state }, n);
      }
    },
  });
}

export async function stopQueueJobs() {
  timers.forEach((t) => clearInterval(t));
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled(queues.map((q) => q.close()));
}
