import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { getEffectiveStartDate, RESTAURANT_START_DATE } from "@/lib/constants";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";
import { getDashboardDateRange } from "@/stores/dashboardFilterStore";

/**
 * Warms key React Query caches for a route in the background.
 * Wire to onMouseEnter/onFocus of nav links so the destination page
 * renders with data already in cache.
 *
 * Uses queryClient.prefetchQuery - silently no-ops if data is fresh.
 */
const STALE = 60 * 1000;
const STALE_LONG = 5 * 60 * 1000;

// Per-session cooldown: don't re-prefetch the same route within this window.
const PREFETCH_COOLDOWN_MS = 30 * 1000;
const lastPrefetchAt = new Map<string, number>();

/**
 * Lightweight logger - keeps prefetch failures visible in dev/console
 * without surfacing toasts or breaking the UI.
 */
function logPrefetchFailure(scope: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[prefetch] ${scope} failed (non-fatal):`, err);
}

/**
 * Wrap a prefetchQuery so a thrown queryFn never bubbles up,
 * and so a failure clears the cooldown for that route key
 * (allowing a real navigation to retry instead of being throttled).
 */
function safePrefetch(
  qc: ReturnType<typeof useQueryClient>,
  cooldownKey: string | null,
  scope: string,
  options: Parameters<ReturnType<typeof useQueryClient>["prefetchQuery"]>[0],
) {
  qc.prefetchQuery(options).catch((err) => {
    logPrefetchFailure(scope, err);
    if (cooldownKey) lastPrefetchAt.delete(cooldownKey);
  });
}

export function usePrefetchRoute() {
  const queryClient = useQueryClient();
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id;
  const timezone = restaurant?.timezone || "Asia/Riyadh";

  return useCallback(
    (path: string) => {
      if (!restaurantId) return;
      // Strip query/hash and trailing slash
      const route = path.split("?")[0].split("#")[0].replace(/\/$/, "") || "/";

      const key = `${restaurantId}:${route}`;
      const now = Date.now();
      const last = lastPrefetchAt.get(key) ?? 0;
      if (now - last < PREFETCH_COOLDOWN_MS) return;
      lastPrefetchAt.set(key, now);

      try {
        switch (route) {
          case "/":
          case "/dashboard":
            prefetchDashboard(queryClient, restaurantId, timezone, key);
            break;
          case "/sales":
            prefetchSales(queryClient, restaurantId, timezone, key);
            break;
          case "/customers":
            prefetchCustomers(queryClient, restaurantId, key);
            break;
          case "/settlements":
            prefetchSettlements(queryClient, restaurantId, key);
            break;
          default:
            break;
        }
      } catch (err) {
        // Dispatcher itself should never break navigation.
        logPrefetchFailure(`dispatch:${route}`, err);
        lastPrefetchAt.delete(key);
      }
    },
    [queryClient, restaurantId, timezone],
  );
}

/**
 * Compute query bounds for the dashboard prefetch. Prefers the user's
 * currently selected dashboard date range (persisted in
 * useDashboardFilterStore) and falls back to "today" when nothing is
 * stored yet (first visit of the session).
 */
function dashboardBounds(timezone: string) {
  const stored = getDashboardDateRange();
  let from: Date;
  let to: Date;

  if (stored?.from && stored?.to) {
    const parsedFrom = new Date(stored.from);
    const parsedTo = new Date(stored.to);
    if (!isNaN(parsedFrom.getTime()) && !isNaN(parsedTo.getTime())) {
      from = new Date(parsedFrom.getFullYear(), parsedFrom.getMonth(), parsedFrom.getDate());
      to = new Date(parsedTo.getFullYear(), parsedTo.getMonth(), parsedTo.getDate());
    } else {
      const now = new Date();
      from = to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
  } else {
    const now = new Date();
    from = to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const effectiveFrom = getEffectiveStartDate(from);
  const effectiveTo = to < RESTAURANT_START_DATE ? RESTAURANT_START_DATE : to;
  const startBounds = getRestaurantDayBoundsUTC(effectiveFrom, timezone);
  const endBounds = getRestaurantDayBoundsUTC(effectiveTo, timezone);
  return {
    startDateUTC: startBounds.start.toISOString(),
    endDateUTC: endBounds.endExclusive.toISOString(),
    startDate: format(effectiveFrom, "yyyy-MM-dd"),
    endDate: format(effectiveTo, "yyyy-MM-dd"),
  };
}

function prefetchDashboard(qc: ReturnType<typeof useQueryClient>, restaurantId: string, timezone: string, cooldownKey: string) {
  const b = dashboardBounds(timezone);

  safePrefetch(qc, cooldownKey, "dashboard.shifts", {
    queryKey: ["dashboard", "shifts", restaurantId],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("id, status, opening_float, expected_cash, counted_cash, variance, opened_at, closed_at, cashier_user_id, cashier_staff_id, drawer_id, template_id")
        .eq("restaurant_id", restaurantId)
        .order("opened_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  safePrefetch(qc, cooldownKey, "dashboard.salesAgg", {
    queryKey: ["dashboard", "salesAgg", restaurantId, b.startDateUTC, b.endDateUTC],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("dashboard_sales_summary", {
        p_restaurant_id: restaurantId, p_start: b.startDateUTC, p_end: b.endDateUTC,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  safePrefetch(qc, cooldownKey, "dashboard.expensesAgg", {
    queryKey: ["dashboard", "expensesAgg", restaurantId, b.startDate, b.endDate],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("dashboard_expense_summary", {
        p_restaurant_id: restaurantId, p_start_date: b.startDate, p_end_date: b.endDate,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  safePrefetch(qc, cooldownKey, "dashboard.staffCount", {
    queryKey: ["dashboard", "staffCount", restaurantId],
    staleTime: STALE_LONG,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("staff").select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId).eq("is_active", true);
      if (error) throw error;
      return count || 0;
    },
  });

  safePrefetch(qc, cooldownKey, "dashboard.drawers", {
    queryKey: ["dashboard", "drawers", restaurantId],
    staleTime: STALE_LONG,
    queryFn: async () => {
      const { data, error } = await supabase.from("drawers").select("id, name").eq("restaurant_id", restaurantId);
      if (error) throw error;
      return data || [];
    },
  });
}

function prefetchSales(qc: ReturnType<typeof useQueryClient>, restaurantId: string, _timezone: string, cooldownKey: string) {
  // Warm only the cheap "today" KPI query so the page header has instant numbers.
  safePrefetch(qc, cooldownKey, "sales.today-total", {
    queryKey: ["sales", "today-total", restaurantId],
    staleTime: STALE,
    queryFn: async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("sales_transactions")
        .select("total_amount")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", today.toISOString());
      if (error) throw error;
      return (data || []).reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0);
    },
  });
}

function prefetchCustomers(qc: ReturnType<typeof useQueryClient>, restaurantId: string, cooldownKey: string) {
  safePrefetch(qc, cooldownKey, "customers.list", {
    queryKey: ["customers", restaurantId],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers").select("*")
        .eq("restaurant_id", restaurantId).order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // NOTE: unpaid balances are branch-scoped (see useBranchUnpaidBalances).
  // Prefetching here has no branch context, so it would seed a tenant-wide
  // cache entry that the page would briefly render. Intentionally not
  // prefetched.
}

function prefetchSettlements(qc: ReturnType<typeof useQueryClient>, restaurantId: string, cooldownKey: string) {
  safePrefetch(qc, cooldownKey, "settlements.customers-with-balance", {
    queryKey: ["customers-with-balance", restaurantId],
    staleTime: STALE,
    queryFn: async () => {
      // Must match the Settlements page query exactly - it derives
      // branch-scoped balances client-side from this unfiltered list.
      const { data, error } = await supabase
        .from("customers").select("*")
        .eq("restaurant_id", restaurantId)
        .order("current_balance", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}