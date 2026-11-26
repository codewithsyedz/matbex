/**
 * Redis for server functions. Functions run inside the API process, which owns the
 * connection (server/src/lib/redis.ts) and publishes it on globalThis; functions bundled
 * separately in production pick up the same client here instead of opening their own.
 * Returns null when Redis is not configured.
 */
import type { Redis } from "ioredis";

export function getRedis(): Redis | null {
  return (globalThis as { __matbexRedis?: Redis | null }).__matbexRedis ?? null;
}
