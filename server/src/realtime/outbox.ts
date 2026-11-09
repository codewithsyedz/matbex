/**
 * Transactional outbox: publisher (worker side) and fan-in (API side).
 *
 *   business transaction ──► platform.outbox_events (+ NOTIFY outbox_event on commit)
 *   worker: publisher     ──► Redis channel  <prefix>events        (marks rows published)
 *   API: every instance   ◄── Redis channel  ──► Socket.IO room "<topic>:<restaurant_id>"
 *
 * Rows are claimed with FOR UPDATE SKIP LOCKED and marked published only after the Redis
 * publish succeeded, inside the same transaction: if Redis is down, events wait instead of
 * being lost. Delivery to sockets is at-least-once and best-effort ordered; clients treat an
 * event as "something changed, refresh" and refetch after reconnecting, so a missed or
 * repeated event is harmless.
 *
 * Without REDIS_URL (ROLE=all only) the publisher hands events straight to the local
 * Socket.IO server.
 */
import type { FastifyBaseLogger } from "fastify";
import client from "prom-client";
import { config } from "../config.js";
import { sql } from "../db.js";
import { registry } from "../lib/metrics.js";
import { redis } from "../lib/redis.js";

export interface OutboxEvent {
  id: number;
  topic: string;
  event_type: string;
  tenant_id: string | null;
  restaurant_id: string | null;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export const EVENTS_CHANNEL = `${config.REDIS_KEY_PREFIX}events`;
const BATCH = 200;

const published = new client.Counter({
  name: "matbex_outbox_published_total",
  help: "Outbox events published, by topic",
  labelNames: ["topic"] as const,
  registers: [registry],
});
const lag = new client.Histogram({
  name: "matbex_outbox_publish_lag_seconds",
  help: "Time from commit (row created) to publish",
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15, 60],
  registers: [registry],
});
new client.Gauge({
  name: "matbex_outbox_pending",
  help: "Outbox events waiting to be published",
  registers: [registry],
  async collect() {
    try {
      const [r] = await sql<{ n: number }[]>`select count(*)::int as n from platform.outbox_events where published_at is null`;
      this.set(r?.n ?? 0);
    } catch {
      /* table missing on a database without the outbox migration */
    }
  },
});

/** In-process hand-off when there is no Redis (ROLE=all). */
let localSink: ((events: OutboxEvent[]) => void) | null = null;
export function setLocalEventSink(fn: (events: OutboxEvent[]) => void) {
  localSink = fn;
}

async function deliver(events: OutboxEvent[]) {
  if (redis) {
    // One message per event keeps messages small; ioredis pipelines them.
    await Promise.all(events.map((e) => redis!.publish(EVENTS_CHANNEL, JSON.stringify(e))));
  } else if (localSink) {
    localSink(events);
  } else {
    throw new Error("no event transport: set REDIS_URL or run the API with ROLE=all");
  }
}

let running = false;
let again = false;

async function publishPending(log: FastifyBaseLogger) {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      for (;;) {
        const n = await sql.begin(async (tx) => {
          const rows = await tx<OutboxEvent[]>`
            select id, topic, event_type, tenant_id, restaurant_id, aggregate_id, payload, created_at
            from platform.outbox_events
            where published_at is null
            order by id
            limit ${BATCH}
            for update skip locked`;
          if (!rows.length) return 0;
          await deliver(rows);
          await tx`update platform.outbox_events set published_at = now() where id in ${tx(rows.map((r) => r.id))}`;
          const now = Date.now();
          for (const r of rows) {
            published.inc({ topic: r.topic });
            lag.observe((now - new Date(r.created_at).getTime()) / 1000);
          }
          return rows.length;
        });
        if (n < BATCH) break;
      }
    } while (again);
  } catch (err) {
    log.warn({ err: (err as Error).message }, "outbox publish failed; will retry");
  } finally {
    running = false;
  }
}

const timers: NodeJS.Timeout[] = [];

export async function startOutboxPublisher(logger: FastifyBaseLogger) {
  const log = logger.child({ mod: "outbox" });
  const exists = await sql`select to_regclass('platform.outbox_events') is not null as ok`;
  if (!exists[0]?.ok) {
    log.warn("platform.outbox_events missing (run migrations); outbox publisher not started");
    return;
  }
  await sql.listen("outbox_event", () => void publishPending(log));
  // Safety net for missed notifications and for retries after a Redis outage.
  timers.push(setInterval(() => void publishPending(log), 2_000));
  // Keep the table small: published events are only needed for a short audit window.
  timers.push(
    setInterval(() => {
      void sql`delete from platform.outbox_events where published_at < now() - make_interval(hours => ${config.OUTBOX_RETENTION_HOURS})`
        .catch((err) => log.warn({ err: err.message }, "outbox cleanup failed"));
    }, 60 * 60_000),
  );
  void publishPending(log);
  log.info({ transport: redis ? "redis" : "in-process" }, "outbox publisher started");
}

export function stopOutboxPublisher() {
  timers.forEach((t) => clearInterval(t));
}
