/**
 * Matbex worker: scheduled jobs, the net.http queue and background tasks (BullMQ on Redis).
 * Same image as the API, started with ROLE=worker (docker-compose.yml service "worker").
 * Serves no API; /metrics and /health are on METRICS_PORT (internal network only).
 */
import Fastify from "fastify";
import { config } from "./config.js";
import { sql } from "./db.js";
import { loadFunctions } from "./functions/host.js";
import { startJobs, stopJobs } from "./jobs/index.js";
import { startMetricsServer } from "./lib/metrics.js";
import { closeRedis } from "./lib/redis.js";

// Fastify only for its logger, so worker logs match the API's JSON format.
const app = Fastify({ logger: { level: config.LOG_LEVEL } });
const log = app.log.child({ role: "worker" });

await loadFunctions(log);
startMetricsServer(log);
await startJobs(log);
log.info("worker ready");

const shutdown = async (signal: string) => {
  log.info({ signal }, "worker shutting down");
  await stopJobs();
  await sql.end({ timeout: 5 });
  await closeRedis();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
