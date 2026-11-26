/**
 * Picks the job runner: BullMQ (jobs/queues.ts) when REDIS_URL is set, otherwise the
 * in-process scheduler (jobs/scheduler.ts, one leader via a Postgres advisory lock).
 */
import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { startQueueJobs, stopQueueJobs } from "./queues.js";
import { startOutboxPublisher, stopOutboxPublisher } from "../realtime/outbox.js";
import { startJobs as startInProcessJobs, stopJobs as stopInProcessJobs } from "./scheduler.js";

let mode: "queue" | "in-process" | "off" = "off";

export async function startJobs(log: FastifyBaseLogger) {
  // The outbox publisher runs wherever background work runs (worker, or ROLE=all). It is not
  // tied to JOBS_ENABLED: kitchen displays need events even when schedules are switched off.
  await startOutboxPublisher(log);
  if (!config.JOBS_ENABLED) {
    log.info("jobs disabled (JOBS_ENABLED=false)");
    return;
  }
  if (config.REDIS_URL) {
    mode = "queue";
    await startQueueJobs(log);
  } else {
    mode = "in-process";
    log.warn("REDIS_URL not set: running scheduled jobs in-process (single leader, no retries)");
    await startInProcessJobs(log);
  }
}

export async function stopJobs() {
  stopOutboxPublisher();
  if (mode === "queue") await stopQueueJobs();
  if (mode === "in-process") stopInProcessJobs();
}
