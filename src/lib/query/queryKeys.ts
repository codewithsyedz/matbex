/**
 * Centralised query-key factory.
 *
 * Why: keys used to be written inline as raw arrays at every call site
 * (`["dashboard", "salesAgg", restaurantId, branchId, ...]`). That made two
 * things fragile:
 *   1. Cache identity — a typo or a differently-ordered scope produced a
 *      *different* cache entry, so the same data was fetched twice.
 *   2. Invalidation — `invalidateQueries({ queryKey: ["dashboard", "sales"] })`
 *      silently matched nothing when the real entity was `salesAgg`.
 *
 * Every key is built here so each logical query gets exactly one independent
 * cache entry, and prefix invalidation is guaranteed to line up.
 *
 * Key shape (positional, prefix-friendly):
 *   [namespace, entity, restaurantId, branchId, ...scope]
 */

export const QUERY_NAMESPACES = [
  "dashboard",
  "monthly-kpi",
  "monthly-stats",
  "branch-comparison",
  "daily-profit",
  "profit-loss",
  "sales-trends",
  "channel-profitability",
  "expenses-totals",
  "unpaid-counts",
  "overhead-allocations",
] as const;

export type QueryNamespace = (typeof QUERY_NAMESPACES)[number];

/** Namespaces whose data is aggregate + read-only, so it is safe to persist. */
export const DASHBOARD_NAMESPACES: readonly QueryNamespace[] = QUERY_NAMESPACES;

export interface QueryScope {
  restaurantId?: string | null;
  branchId?: string | null;
  /** Extra discriminators (date bounds, ids, filters). Order matters. */
  extra?: ReadonlyArray<string | number | boolean | null | undefined>;
}

export type QueryKey = ReadonlyArray<unknown>;

function normalize(value: string | number | boolean | null | undefined) {
  return value === undefined ? null : value;
}

function buildKey(namespace: string, entity: string, scope: QueryScope = {}): QueryKey {
  return [
    namespace,
    entity,
    normalize(scope.restaurantId),
    normalize(scope.branchId),
    ...(scope.extra ?? []).map(normalize),
  ];
}

/**
 * Creates the key helpers for one namespace.
 *
 * - `all()`            → invalidate the whole namespace
 * - `scope(r)`         → invalidate everything for one restaurant
 * - `entity(e, scope)` → the independent cache entry for a single query
 */
export function createKeyFactory<N extends string>(namespace: N) {
  return {
    namespace,
    all: (): QueryKey => [namespace],
    /**
     * Prefix for one entity. Omit `restaurantId` to match every restaurant —
     * passing an explicit `null` would NOT match keys built with a real id,
     * because react-query compares prefix elements positionally.
     */
    entityAll: (entity: string, restaurantId?: string | null): QueryKey =>
      restaurantId === undefined ? [namespace, entity] : [namespace, entity, restaurantId],
    entity: (entity: string, scope?: QueryScope): QueryKey => buildKey(namespace, entity, scope),
  };
}

export const qk = {
  dashboard: createKeyFactory("dashboard"),
  monthlyKpi: createKeyFactory("monthly-kpi"),
  monthlyStats: createKeyFactory("monthly-stats"),
  branchComparison: createKeyFactory("branch-comparison"),
  dailyProfit: createKeyFactory("daily-profit"),
  profitLoss: createKeyFactory("profit-loss"),
  salesTrends: createKeyFactory("sales-trends"),
  channelProfitability: createKeyFactory("channel-profitability"),
  expensesTotals: createKeyFactory("expenses-totals"),
  unpaidCounts: createKeyFactory("unpaid-counts"),
  overheadAllocations: createKeyFactory("overhead-allocations"),
} as const;

/** True when a key belongs to one of the cacheable dashboard namespaces. */
export function isDashboardKey(key: unknown): boolean {
  if (!Array.isArray(key)) return false;
  const root = key[0];
  return typeof root === "string" && (DASHBOARD_NAMESPACES as readonly string[]).includes(root);
}
