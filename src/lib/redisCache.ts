import { supabase } from "@/integrations/supabase/client";

// Default TTL (45s) - short enough to keep dashboards fresh, long enough to
// absorb spikes of repeat navigation on mobile.
const DEFAULT_TTL = 45;

// In-flight de-dup so concurrent useQuery calls share a single request.
const inflight = new Map<string, Promise<any>>();

function stableKey(parts: unknown): string {
  // Stable JSON stringify (sort object keys) so identical queries hash the same.
  const seen = new WeakSet();
  const norm = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(norm);
    return Object.keys(v)
      .sort()
      .reduce((acc, k) => {
        acc[k] = norm(v[k]);
        return acc;
      }, {} as Record<string, any>);
  };
  return JSON.stringify(norm(parts));
}

async function callProxy<T>(body: Record<string, unknown>): Promise<T | null> {
  try {
    // Skip when there's no live session - the edge function would 401 and
    // the SDK would surface a "FunctionsHttpError" runtime error. We also
    // refresh proactively when the cached token is expired or about to
    // expire (within 30s) since supabase-js will otherwise send the stale
    // token and the edge function will reject it.
    let { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    const expiresAt = (session.expires_at ?? 0) * 1000;
    if (expiresAt && expiresAt - Date.now() < 30_000) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (!refreshed?.session?.access_token) return null;
      session = refreshed.session;
    }
    const { data, error } = await supabase.functions.invoke("cache-proxy", {
      body,
    });
    if (error) return null;
    return (data as T) ?? null;
  } catch {
    return null;
  }
}

export async function redisGet<T = unknown>(key: string): Promise<T | null> {
  const res = await callProxy<{ hit: boolean; value: T }>({ op: "get", key });
  return res?.hit ? res.value : null;
}

export async function redisSet(
  key: string,
  value: unknown,
  ttl: number = DEFAULT_TTL,
): Promise<void> {
  // fire-and-forget
  void callProxy({ op: "set", key, value, ttl });
}

export async function redisDel(key: string): Promise<void> {
  void callProxy({ op: "del", key });
}

/**
 * Wrap a queryFn with a Redis cache layer.
 * - Returns cached value if present (single edge call → ~80-150ms on mobile).
 * - On miss, runs the original queryFn and writes the result to Redis.
 * - On Redis errors falls back to the original queryFn silently.
 */
export function cachedQueryFn<T>(
  queryKey: readonly unknown[],
  ttl: number,
  fn: () => Promise<T>,
): () => Promise<T> {
  const key = stableKey(queryKey);

  return async () => {
    // De-dup concurrent fetches for the same key in this tab.
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;

    const work = (async () => {
      const hit = await redisGet<T>(key);
      if (hit !== null && hit !== undefined) {
        // Background refresh so the cache never goes stale-cold.
        // Disabled when TTL <= 30s to avoid excess writes.
        if (ttl > 30) {
          setTimeout(() => {
            fn()
              .then((fresh) => redisSet(key, fresh, ttl))
              .catch(() => {});
          }, 0);
        }
        return hit;
      }
      const fresh = await fn();
      void redisSet(key, fresh, ttl);
      return fresh;
    })();

    inflight.set(key, work);
    try {
      return await work;
    } finally {
      inflight.delete(key);
    }
  };
}

export const CACHE_TTL = {
  SHORT: 30, // sales / shifts / live dashboard
  MEDIUM: 60, // reports, P&L aggregations
  LONG: 300, // reference data (staff list, drawers, categories)
} as const;

// Re-export a drop-in replacement for useQuery that transparently caches
// the queryFn result in Redis (45s TTL by default, scoped by tenant + user).
// Use this on heavy dashboard/report reads. Mutations & writes must NOT use it.
import { useQuery, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";

export function useCachedQuery<TData = unknown, TError = Error>(
  options: UseQueryOptions<TData, TError> & { ttl?: number },
): UseQueryResult<TData, TError> {
  const { ttl = DEFAULT_TTL, queryFn, queryKey, ...rest } = options;
  const wrapped =
    queryFn && typeof queryFn === "function"
      ? cachedQueryFn(queryKey as readonly unknown[], ttl, queryFn as () => Promise<TData>)
      : (queryFn as any);
  return useQuery({ ...rest, queryKey, queryFn: wrapped as any });
}