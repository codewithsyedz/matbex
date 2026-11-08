import { keepPreviousData, type UseQueryOptions } from "@tanstack/react-query";

/**
 * Shared cache policy tiers.
 *
 * Dashboard data is aggregate and revalidated by realtime invalidation, so it
 * can stay stale for minutes without going wrong. Reference data (drawers,
 * staff, branches) changes rarely. Operational data must stay near-live.
 */
export const STALE_TIME = {
  live: 15_000,
  short: 60_000,
  /** Default for dashboard aggregates. */
  dashboard: 3 * 60_000,
  reference: 5 * 60_000,
  static: 30 * 60_000,
} as const;

export const GC_TIME = {
  dashboard: 10 * 60_000,
  reference: 30 * 60_000,
} as const;

type BaseOptions = Pick<
  UseQueryOptions<any, any, any, any>,
  "staleTime" | "gcTime" | "refetchOnWindowFocus" | "refetchOnReconnect" | "refetchOnMount" | "placeholderData"
>;

/**
 * Options for a dashboard-route query: independently cached, never refetched
 * on window focus (POS tablets and desktops switch focus constantly), and it
 * keeps showing the previous branch/date result while the new one loads.
 */
export function dashboardQueryOptions(
  overrides?: Partial<BaseOptions> & { keepPrevious?: boolean },
): BaseOptions {
  const { keepPrevious = true, ...rest } = overrides ?? {};
  return {
    staleTime: STALE_TIME.dashboard,
    gcTime: GC_TIME.dashboard,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
    ...rest,
  };
}

/** Slow-changing lookup data (drawers, staff, branches, settings). */
export function referenceQueryOptions(overrides?: Partial<BaseOptions>): BaseOptions {
  return {
    staleTime: STALE_TIME.reference,
    gcTime: GC_TIME.reference,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...overrides,
  };
}
