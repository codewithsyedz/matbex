/**
 * Prometheus metrics. Served on a separate internal port (METRICS_PORT, default 9464) so
 * they never go out through Caddy; Prometheus scrapes api:9464 inside the Docker network.
 *
 * Labels use route templates (e.g. "/rest/v1/*", "/functions/v1/:name") and function / job
 * names, never raw URLs or ids, so the number of series stays bounded.
 */
import { createServer } from "node:http";
import type { FastifyInstance } from "fastify";
import client from "prom-client";
import { config } from "../config.js";
import { sql } from "../db.js";
import { redisStatus } from "./redis.js";

export const registry = new client.Registry();
registry.setDefaultLabels({ service: config.ROLE === "worker" ? "matbex-worker" : "matbex-api" });
client.collectDefaultMetrics({ register: registry, prefix: "matbex_" });

const httpDuration = new client.Histogram({
  name: "matbex_http_request_duration_seconds",
  help: "HTTP request duration by route template, method and status class",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const functionInvocations = new client.Counter({
  name: "matbex_function_invocations_total",
  help: "Server function invocations by function name and status class",
  labelNames: ["function", "status"] as const,
  registers: [registry],
});

export const functionDuration = new client.Histogram({
  name: "matbex_function_duration_seconds",
  help: "Server function duration by function name",
  labelNames: ["function"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const jobRuns = new client.Counter({
  name: "matbex_job_runs_total",
  help: "Scheduled job runs (cron.job SQL jobs and scheduled functions) by job and result",
  labelNames: ["job", "kind", "result"] as const,
  registers: [registry],
});

export const httpQueueDeliveries = new client.Counter({
  name: "matbex_net_http_deliveries_total",
  help: "net.http_post() queue deliveries by status class",
  labelNames: ["status"] as const,
  registers: [registry],
});

new client.Gauge({
  name: "matbex_dependency_up",
  help: "1 when a dependency answers, 0 when it does not (redis: -1 when not configured)",
  labelNames: ["dependency"] as const,
  registers: [registry],
  async collect() {
    try {
      await sql`select 1`;
      this.set({ dependency: "postgres" }, 1);
    } catch {
      this.set({ dependency: "postgres" }, 0);
    }
    const r = await redisStatus();
    this.set({ dependency: "redis" }, r === "ok" ? 1 : r === "disabled" ? -1 : 0);
  },
});

new client.Gauge({
  name: "matbex_net_http_queue_pending",
  help: "Rows waiting in net.http_request_queue",
  registers: [registry],
  async collect() {
    try {
      const [r] = await sql<{ n: number }[]>`select count(*)::int as n from net.http_request_queue where status_code is null and error is null`;
      this.set(r?.n ?? 0);
    } catch {
      /* table missing on a fresh database */
    }
  },
});

const statusClass = (code: number) => `${Math.floor(code / 100)}xx`;

/** Records every HTTP request against its route template. */
export function registerHttpMetrics(app: FastifyInstance) {
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions?.url ?? "unmatched";
    httpDuration.observe(
      { method: req.method, route, status: statusClass(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });
}

/** Separate listener for /metrics; not routed through Caddy. */
export function startMetricsServer(log: FastifyInstance["log"]) {
  if (!config.METRICS_PORT) return;
  const server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, role: config.ROLE }));
      return;
    }
    if (req.url !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    try {
      res.writeHead(200, { "content-type": registry.contentType });
      res.end(await registry.metrics());
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  server.listen(config.METRICS_PORT, config.METRICS_HOST, () =>
    log.info({ port: config.METRICS_PORT, host: config.METRICS_HOST }, "metrics listening on /metrics"),
  );
  server.unref();
}

export { statusClass };
