/**
 * Matbex API server.
 *
 *   /auth/v1/*        auth & sessions            (src/auth)
 *   /rest/v1/*        data API gateway           (src/rest → PostgREST)
 *   /storage/v1/*     object storage             (src/storage)
 *   /realtime/v1/*    websocket change feed      (src/realtime)
 *   /functions/v1/*   server functions           (server/functions/*)
 *   /mcp              MCP tools endpoint         (src/mcp)
 *   /api/v1/*         typed endpoints (strangler target — add domains here)
 *   /health           liveness / readiness
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { config, isAllowedOrigin } from "./config.js";
import { sql } from "./db.js";
import { HttpError } from "./lib/errors.js";
import { authRoutes } from "./auth/routes.js";
import { restGateway } from "./rest/gateway.js";
import { storageRoutes } from "./storage/routes.js";
import { realtimeRoutes } from "./realtime/hub.js";
import { functionRoutes, loadFunctions } from "./functions/host.js";
import { mcpRoutes } from "./mcp/server.js";
import { startJobs, stopJobs } from "./jobs/scheduler.js";

const app = Fastify({
  logger: { level: config.LOG_LEVEL, ...(config.NODE_ENV === "development" ? { transport: undefined } : {}) },
  trustProxy: true,
  bodyLimit: 10 * 1024 * 1024,
});

await app.register(cors, {
  origin: (origin, cb) => {
    // Native shells (Capacitor) and server-to-server calls have no / special origins.
    if (!origin || isAllowedOrigin(origin) || /^(capacitor|ionic):\/\/localhost$/.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    cb(null, false);
  },
  credentials: true,
  exposedHeaders: ["content-range", "x-request-id", "content-profile", "x-ai-run-id"],
  maxAge: 86400,
});
await app.register(rateLimit, { global: false });
await app.register(websocket);

app.setErrorHandler((err: any, req, reply) => {
  if (err instanceof HttpError) {
    return reply.code(err.status).send({ code: err.code ?? err.status, error_code: err.code, msg: err.message, message: err.message });
  }
  const status = (err as any).statusCode ?? 500;
  if (status >= 500) req.log.error({ err }, "unhandled error");
  return reply.code(status).send({ code: status, message: status >= 500 ? "Internal server error" : err.message });
});

app.get("/health", async () => {
  await sql`select 1`;
  return { ok: true, service: "matbex-api", time: new Date().toISOString() };
});

await app.register(authRoutes, { prefix: "/auth/v1" });
await app.register(restGateway, { prefix: "/rest/v1" });
await app.register(storageRoutes, { prefix: "/storage/v1" });
await app.register(realtimeRoutes, { prefix: "/realtime/v1" });
await app.register(functionRoutes, { prefix: "/functions/v1" });
await app.register(mcpRoutes, { prefix: "/mcp" });

await loadFunctions(app.log);
await app.listen({ port: config.PORT, host: config.HOST });
await startJobs(app.log);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  stopJobs();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
