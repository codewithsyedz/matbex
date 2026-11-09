/**
 * Socket.IO event server (path /socket.io on the API). Kitchen displays and POS terminals
 * receive outbox events for the restaurants they may access.
 *
 *   connect      handshake auth: { token: <user access token> }   (websocket transport only,
 *                so several API replicas work without sticky sessions)
 *   subscribe    { topic: "kds", restaurantId }  → ack { ok } ; joins room "kds:<restaurantId>"
 *                only if public.can_access_restaurant() is true for this user (checked in
 *                Postgres as the caller, the same rule RLS uses)
 *   unsubscribe  { topic, restaurantId }
 *   <topic>      server → client: { id, type, restaurantId, aggregateId, payload, at }
 *
 * The connection is closed when the access token expires; the client reconnects with a fresh
 * token and re-subscribes.
 */
import type { FastifyInstance } from "fastify";
import { Server, type Socket } from "socket.io";
import client from "prom-client";
import { isAllowedOrigin } from "../config.js";
import { asCaller, type DbClaims } from "../db.js";
import { verify } from "../lib/jwt.js";
import { registry } from "../lib/metrics.js";
import { redis } from "../lib/redis.js";
import { EVENTS_CHANNEL, setLocalEventSink, type OutboxEvent } from "./outbox.js";

const TOPICS = new Set(["kds", "pos"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emitted = new client.Counter({
  name: "matbex_socket_events_emitted_total",
  help: "Events emitted to Socket.IO rooms, by topic",
  labelNames: ["topic"] as const,
  registers: [registry],
});

let io: Server | null = null;

function emitEvents(events: OutboxEvent[]) {
  if (!io) return;
  for (const e of events) {
    if (!e.restaurant_id || !TOPICS.has(e.topic)) continue;
    io.to(`${e.topic}:${e.restaurant_id}`).emit(e.topic, {
      id: e.id,
      type: e.event_type,
      restaurantId: e.restaurant_id,
      aggregateId: e.aggregate_id,
      payload: e.payload,
      at: e.created_at,
    });
    emitted.inc({ topic: e.topic });
  }
}

export async function startSocketServer(app: FastifyInstance) {
  const log = app.log.child({ mod: "socket" });

  // Two websocket stacks share the HTTP server: @fastify/websocket (/realtime/v1) routes every
  // upgrade through Fastify (404 for /socket.io), and engine.io destroys upgrades for paths it
  // does not own. Route each upgrade to exactly one of them.
  const fastifyUpgrade = app.server.listeners("upgrade") as ((...a: unknown[]) => void)[];
  app.server.removeAllListeners("upgrade");
  const created = new Server(app.server, {
    path: "/socket.io",
    transports: ["websocket"],
    serveClient: false,
    cors: {
      origin: (origin, cb) =>
        cb(null, !origin || isAllowedOrigin(origin) || /^(capacitor|ionic):\/\/localhost$/.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)),
      credentials: true,
    },
  });
  io = created;
  const engineUpgrade = app.server.listeners("upgrade") as ((...a: unknown[]) => void)[];
  app.server.removeAllListeners("upgrade");
  app.server.on("upgrade", (req: { url?: string }, ...rest: unknown[]) => {
    const target = req.url?.startsWith("/socket.io") ? engineUpgrade : fastifyUpgrade;
    for (const l of target) l.call(app.server, req, ...rest);
  });

  new client.Gauge({
    name: "matbex_socket_connections",
    help: "Open Socket.IO connections on this API instance",
    registers: [registry],
    collect() {
      this.set(io?.engine.clientsCount ?? 0);
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string })?.token;
      if (!token) return next(new Error("unauthorized"));
      const claims = await verify<DbClaims & { exp?: number }>(token);
      if (claims.role !== "authenticated" || !claims.sub) return next(new Error("unauthorized"));
      socket.data.claims = claims;
      if (claims.exp) {
        const ms = claims.exp * 1000 - Date.now();
        const t = setTimeout(() => socket.disconnect(true), Math.max(ms, 0));
        socket.once("disconnect", () => clearTimeout(t));
      }
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.on("subscribe", async (msg: { topic?: string; restaurantId?: string }, ack?: (r: { ok: boolean; error?: string }) => void) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      const topic = msg?.topic ?? "";
      const rid = msg?.restaurantId ?? "";
      if (!TOPICS.has(topic) || !UUID.test(rid)) return reply({ ok: false, error: "invalid subscription" });
      try {
        const [row] = await asCaller(socket.data.claims as DbClaims, (tx) => tx<{ ok: boolean }[]>`select public.can_access_restaurant(${rid}::uuid) as ok`);
        if (!row?.ok) return reply({ ok: false, error: "forbidden" });
        await socket.join(`${topic}:${rid}`);
        reply({ ok: true });
      } catch (err) {
        log.warn({ err: (err as Error).message }, "subscribe failed");
        reply({ ok: false, error: "subscribe failed" });
      }
    });
    socket.on("unsubscribe", async (msg: { topic?: string; restaurantId?: string }) => {
      if (msg?.topic && msg?.restaurantId) await socket.leave(`${msg.topic}:${msg.restaurantId}`);
    });
  });

  if (redis) {
    // Every API instance receives every event and emits to its own clients.
    const sub = redis.duplicate({ keyPrefix: "", enableOfflineQueue: true, maxRetriesPerRequest: null });
    sub.on("message", (_channel, message) => {
      try {
        emitEvents([JSON.parse(message) as OutboxEvent]);
      } catch (err) {
        log.warn({ err: (err as Error).message }, "bad event message");
      }
    });
    await sub.subscribe(EVENTS_CHANNEL);
    app.addHook("onClose", async () => {
      await sub.quit().catch(() => sub.disconnect());
    });
  } else {
    setLocalEventSink(emitEvents);
  }
  app.addHook("onClose", async () => {
    await new Promise<void>((resolve) => io?.close(() => resolve()));
  });
  log.info({ path: "/socket.io", transport: redis ? "redis" : "in-process" }, "socket.io events ready");
  return io;
}

/** For tests and diagnostics. */
export function socketServer() {
  return io;
}

