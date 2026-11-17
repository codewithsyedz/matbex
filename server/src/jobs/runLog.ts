/**
 * public.job_runs: one row per scheduled run (function schedule, cron.job SQL, or a function
 * call queued by a cron job), kept 14 days, for the SuperAdmin job status page. Written by both
 * job runners (queues.ts with Redis, scheduler.ts without). Recording never fails the job.
 */
import type { FastifyBaseLogger } from "fastify";
import { sql } from "../db.js";

export type RunKind = "function" | "sql" | "queued";

export async function recordRun(
  log: FastifyBaseLogger | undefined,
  job: string, kind: RunKind, started: Date, ok: boolean, httpStatus: number | null, summary: string | null,
) {
  await sql`
    insert into public.job_runs (job, kind, started_at, status, http_status, summary)
    values (${job}, ${kind}, ${started}, ${ok ? "succeeded" : "failed"}, ${httpStatus}, ${summary ? summary.slice(0, 1000) : null})`
    .catch((err) => log?.warn({ err: err?.message, job }, "could not record job run"));
}

export async function pruneRuns(log: FastifyBaseLogger | undefined) {
  await sql`delete from public.job_runs where started_at < now() - interval '14 days'`
    .catch((err) => log?.warn({ err: err?.message }, "could not prune job runs"));
}
