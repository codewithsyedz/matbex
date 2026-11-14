/**
 * Shared Redis connection (cache + rate-limit counters).
 *
 * Redis is optional: with REDIS_URL unset the API still runs, rate limits fall back to
 * per-process memory and cache-proxy reports misses. Server functions are bundled
 * separately in production but run in this process, so they borrow this connection
 * through globalThis (see server/functions/_runtime/redis.ts) instead of opening their own.
 */
import { Redis } from "ioredis";
import { config } from "../config.js";

declare global {
  var __matbexRedis: Redis | null | undefined;
}

function connect(): Redis | null {
  if (!config.REDIS_URL) return null;
  const client = new Redis(config.REDIS_URL, {
    keyPrefix: config.REDIS_KEY_PREFIX,
    connectTimeout: 2_000,
    // Fail fast instead of queueing: callers treat Redis errors as a cache miss / skip.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  // ioredis reconnects on its own; log at most once a minute while it is down.
  let lastLog = 0;
  client.on("error", (err) => {
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      console.warn(`[redis] ${err.message}`);
    }
  });
  return client;
}

export const redis: Redis | null = globalThis.__matbexRedis ?? connect();
globalThis.__matbexRedis = redis;

/** For /health: "disabled" when not configured, otherwise ok/down. */
export async function redisStatus(): Promise<"ok" | "down" | "disabled"> {
  if (!redis) return "disabled";
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 1_000)),
    ]);
    return pong === "PONG" ? "ok" : "down";
  } catch {
    return "down";
  }
}

export async function closeRedis() {
  if (redis) await redis.quit().catch(() => redis.disconnect());
}
