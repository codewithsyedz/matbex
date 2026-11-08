/**
 * /rest/v1 — data API gateway.
 *
 * Forwards to an internal PostgREST instance (open-source, runs next to the
 * API, not exposed publicly). PostgREST verifies our JWT, switches to the
 * caller's role and sets request.jwt.claims so auth.uid() + RLS work.
 *
 * This is the "strangler" seam: as domains move to typed endpoints under
 * /api/v1, their tables can be locked down here (see BLOCKED_TABLES).
 */
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

/** Tables no longer reachable from the browser once migrated to /api/v1. */
const BLOCKED_TABLES = new Set<string>([]);

const HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "accept-encoding"]);

export async function restGateway(app: FastifyInstance) {
  // Raw passthrough body (PostgREST parses it).
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.all("/*", async (req, reply) => {
    const path = (req.params as { "*": string })["*"] ?? "";
    const resource = path.split("/")[0];
    if (BLOCKED_TABLES.has(resource)) {
      return reply.code(404).send({ code: "PGRST205", message: `Resource ${resource} is served by /api/v1`, details: null, hint: null });
    }

    const qs = req.raw.url!.includes("?") ? req.raw.url!.slice(req.raw.url!.indexOf("?")) : "";
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP.has(k)) continue;
      headers[k] = Array.isArray(v) ? v.join(",") : v;
    }
    // Browser clients send no bearer when signed out: PostgREST then uses the anon role.

    const upstream = await fetch(`${config.POSTGREST_URL}/${path}${qs}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" || !req.body ? undefined : new Uint8Array(req.body as Buffer),
    });

    reply.code(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!HOP.has(key) && key !== "content-encoding") reply.header(key, value);
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    return reply.send(buf);
  });
}
