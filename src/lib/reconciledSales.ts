import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shared helper for computing reconciled Sales totals everywhere a
 * "Sales vs Expenses" or "Filtered Total" comparison is shown.
 *
 * Reconciliation rule (single source of truth):
 *   1. Start from raw POS `sales_transactions` summed per business day.
 *   2. Add net **active** `day_end_adjustments` (scope = `daily_sales`),
 *      skipping reversed originals and reversal entries.
 *   3. **Override** with `daily_sales_summary.total_sales` for any day that
 *      has a reconciled summary row — this is the "Adjusted Total" that the
 *      Daily Sales recorder writes when the operator closes the day.
 *
 * Use `fetchReconciledSalesByDay` or `useReconciledSales` everywhere — never
 * roll this logic by hand again.
 */

export interface ReconciledSalesResult {
  /** Total sales across the range after reconciliation. */
  total: number;
  /** Number of raw POS transactions inside the range. */
  txCount: number;
  /** Final per-day map after override + adjustments. Key: `yyyy-MM-dd`. */
  perDay: Map<string, number>;
  /** Days that have a reconciled summary row (override applied). */
  summaryByDay: Map<string, number>;
  /** Per-day breakdown from `daily_sales_summary` when present. */
  summaryDetailByDay: Map<
    string,
    { total: number; cash: number; card: number; delivery: number; other: number }
  >;
  /** Net active day-end adjustment per day (additive on top of raw POS). */
  adjustmentsByDay: Map<string, number>;
  /** Raw POS sum per day, before adjustments / overrides. */
  rawTxByDay: Map<string, number>;
  /**
   * True when `summaryDetailByDay` was derived from branch POS transactions
   * (branch view) rather than read from tenant-wide `daily_sales_summary`.
   */
  summaryDerivedFromBranchPos?: boolean;
  /** Total sales for days that have already been closed (daily_sales_summary exists). */
  closedTotal: number;
  /** Cash sales for closed days only. */
  closedCash: number;
  /** Card sales for closed days only. */
  closedCard: number;
  /** Number of POS transactions recorded on closed days only. */
  closedTxCount: number;
}

export interface ReconciledSalesInputs {
  txRows: Array<{
    total: number | string | null;
    created_at: string;
    payment_method?: string | null;
    is_delivery?: boolean | null;
  }>;
  summaryRows: Array<{
    sales_date: string;
    total_sales: number | string | null;
    cash_sales?: number | string | null;
    card_sales?: number | string | null;
    delivery_sales?: number | string | null;
    other_sales?: number | string | null;
  }>;
  adjRows: Array<{
    amount: number | string | null;
    business_date: string;
    reversed_at: string | null;
    reversal_of_id: string | null;
  }>;
}

/** Pure merger — useful for tests and when callers already have the rows. */
export function mergeReconciledSales({
  txRows,
  summaryRows,
  adjRows,
}: ReconciledSalesInputs): ReconciledSalesResult {
  const rawTxByDay = new Map<string, number>();
  for (const r of txRows || []) {
    const k = format(new Date(r.created_at), "yyyy-MM-dd");
    rawTxByDay.set(k, (rawTxByDay.get(k) || 0) + Number(r.total || 0));
  }

  const adjustmentsByDay = new Map<string, number>();
  for (const r of adjRows || []) {
    if (r.reversed_at || r.reversal_of_id) continue;
    const k = r.business_date;
    adjustmentsByDay.set(k, (adjustmentsByDay.get(k) || 0) + Number(r.amount || 0));
  }

  const summaryByDay = new Map<string, number>();
  const summaryDetailByDay = new Map<
    string,
    { total: number; cash: number; card: number; delivery: number; other: number }
  >();
  for (const r of summaryRows || []) {
    const total = Number(r.total_sales || 0);
    // A day can have one closed summary per branch — accumulate so the
    // all-branches view isn't reduced to a single branch's numbers.
    summaryByDay.set(r.sales_date, (summaryByDay.get(r.sales_date) || 0) + total);
    const prev = summaryDetailByDay.get(r.sales_date);
    summaryDetailByDay.set(r.sales_date, {
      total: (prev?.total || 0) + total,
      cash: (prev?.cash || 0) + Number(r.cash_sales || 0),
      card: (prev?.card || 0) + Number(r.card_sales || 0),
      delivery: (prev?.delivery || 0) + Number(r.delivery_sales || 0),
      other: (prev?.other || 0) + Number(r.other_sales || 0),
    });
  }

  const perDay = new Map<string, number>();
  for (const [k, v] of rawTxByDay) perDay.set(k, v);
  for (const [k, v] of adjustmentsByDay) perDay.set(k, (perDay.get(k) || 0) + v);
  for (const [k, v] of summaryByDay) perDay.set(k, v); // override wins

  const total = Array.from(perDay.values()).reduce((s, v) => s + v, 0);
  const txCount = (txRows || []).length;

  const closedTotal = Array.from(summaryByDay.values()).reduce((s, v) => s + v, 0);
  const closedCash = Array.from(summaryByDay.keys()).reduce(
    (s, day) => s + (summaryDetailByDay.get(day)?.cash || 0),
    0
  );
  const closedCard = Array.from(summaryByDay.keys()).reduce(
    (s, day) => s + (summaryDetailByDay.get(day)?.card || 0),
    0
  );
  const closedTxCount = (txRows || []).filter((r) =>
    summaryByDay.has(format(new Date(r.created_at), "yyyy-MM-dd"))
  ).length;

  return {
    total,
    txCount,
    perDay,
    summaryByDay,
    summaryDetailByDay,
    adjustmentsByDay,
    rawTxByDay,
    closedTotal,
    closedCash,
    closedCard,
    closedTxCount,
  };
}

/**
 * Resolve the reconciled sales value for a single day given a raw POS total.
 * Mirrors the override-then-adjust rule used by `mergeReconciledSales`.
 */
export function reconcileDaySales(
  dayStr: string,
  rawTxTotal: number,
  reconciled: Pick<ReconciledSalesResult, "summaryByDay" | "adjustmentsByDay">
): number {
  if (reconciled.summaryByDay.has(dayStr)) {
    return reconciled.summaryByDay.get(dayStr) || 0;
  }
  return rawTxTotal + (reconciled.adjustmentsByDay.get(dayStr) || 0);
}

/** Per-day, raw-vs-adjusted vs final view used by the breakdown panel. */
export interface DayBreakdown {
  rawPos: number;
  adjustments: number;
  final: number;
  source: "summary" | "adjusted" | "raw";
}

export function buildDayBreakdown(
  dayStr: string,
  reconciled: Pick<
    ReconciledSalesResult,
    "rawTxByDay" | "adjustmentsByDay" | "summaryByDay"
  >
): DayBreakdown {
  const rawPos = reconciled.rawTxByDay.get(dayStr) || 0;
  const adjustments = reconciled.adjustmentsByDay.get(dayStr) || 0;
  if (reconciled.summaryByDay.has(dayStr)) {
    return {
      rawPos,
      adjustments,
      final: reconciled.summaryByDay.get(dayStr) || 0,
      source: "summary",
    };
  }
  return {
    rawPos,
    adjustments,
    final: rawPos + adjustments,
    source: adjustments !== 0 ? "adjusted" : "raw",
  };
}

/**
 * Pick the cash/card/unpaid values to display for a given day. When a closed
 * `daily_sales_summary` exists we prefer its payment-method breakdown (the
 * operator-reconciled split). Otherwise fall back to raw POS sums.
 */
export function pickDayPaymentBreakdown(
  dayStr: string,
  rawCash: number,
  rawCard: number,
  rawUnpaid: number,
  reconciled: Pick<ReconciledSalesResult, "summaryDetailByDay">
): {
  cash: number;
  card: number;
  unpaid: number;
  source: "summary" | "raw";
} {
  const detail = reconciled.summaryDetailByDay.get(dayStr);
  if (detail) {
    return {
      cash: detail.cash,
      card: detail.card,
      // Closed summary doesn't track unpaid separately — keep the raw POS value.
      unpaid: rawUnpaid,
      source: "summary",
    };
  }
  return { cash: rawCash, card: rawCard, unpaid: rawUnpaid, source: "raw" };
}

export interface FetchReconciledSalesArgs {
  restaurantId: string;
  /** Inclusive `yyyy-MM-dd`. */
  dateFrom: string;
  /** Inclusive `yyyy-MM-dd`. */
  dateTo: string;
  /**
   * Optional branch scope. When set, only `sales_transactions` rows for that
   * branch are counted. `day_end_adjustments` are also branch-scoped: in a
   * branch view only adjustments tagged with that branch are applied.
   * `daily_sales_summary` is branch-scoped too: in a branch view only that
   * branch's closed day rows override POS totals.
   */
  branchId?: string | null;
}

/** Fetch the three reconciliation sources and return the merged result. */
export async function fetchReconciledSalesByDay({
  restaurantId,
  dateFrom,
  dateTo,
  branchId = null,
}: FetchReconciledSalesArgs): Promise<ReconciledSalesResult> {
  const startISO = startOfDay(parseISO(dateFrom)).toISOString();
  const endISO = endOfDay(parseISO(dateTo)).toISOString();

  const [txRes, summaryRes, adjRes] = await Promise.all([
    (async () => {
      // PostgREST caps a single response at 1000 rows — page through so busy
      // ranges are never silently truncated.
      const PAGE = 1000;
      const all: any[] = [];
      for (let page = 0; ; page++) {
        let q = supabase
          .from("sales_transactions")
          .select("total, created_at, payment_method, is_delivery")
          .eq("restaurant_id", restaurantId)
          .gte("created_at", startISO)
          .lte("created_at", endISO)
          .order("created_at", { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (branchId === "untagged") q = q.is("branch_id", null);
        else if (branchId) q = q.eq("branch_id", branchId);
        const res = await q;
        if (res.error) return res;
        const rows = res.data || [];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      return { data: all, error: null } as any;
    })(),
    (async () => {
      let q = supabase
        .from("daily_sales_summary")
        .select("sales_date, total_sales, cash_sales, card_sales, delivery_sales, other_sales")
        .eq("restaurant_id", restaurantId)
        .gte("sales_date", dateFrom)
        .lte("sales_date", dateTo);
      if (branchId === "untagged") q = q.is("branch_id", null);
      else if (branchId) q = q.eq("branch_id", branchId);
      return await q;
    })(),
    (async () => {
      let q = supabase
        .from("day_end_adjustments")
        .select("amount, business_date, reversed_at, reversal_of_id")
        .eq("restaurant_id", restaurantId)
        .eq("scope", "daily_sales")
        .gte("business_date", dateFrom)
        .lte("business_date", dateTo);
      if (branchId === "untagged") q = q.is("branch_id", null);
      else if (branchId) q = q.eq("branch_id", branchId);
      return await q;
    })(),
  ]);

  if (txRes.error) throw txRes.error;
  if (summaryRes.error) throw summaryRes.error;
  if (adjRes.error) throw adjRes.error;

  const merged = mergeReconciledSales({
    txRows: (txRes.data || []) as any,
    summaryRows: (summaryRes.data || []) as any,
    adjRows: (adjRes.data || []) as any,
  });

  // Branch view fallback: for days this branch has NOT closed, derive the
  // per-day payment breakdown from its POS transactions (plus branch-tagged
  // adjustments) so daily charts match the branch view.
  if (branchId) {
    for (const [day, rawTotal] of merged.rawTxByDay) {
      if (merged.summaryByDay.has(day)) continue;
      const adj = merged.adjustmentsByDay.get(day) || 0;
      merged.summaryDetailByDay.set(day, {
        total: rawTotal + adj,
        cash: 0,
        card: 0,
        delivery: 0,
        other: 0,
      });
    }
    for (const r of (txRes.data || []) as any[]) {
      const day = format(new Date(r.created_at), "yyyy-MM-dd");
      if (merged.summaryByDay.has(day)) continue;
      const d = merged.summaryDetailByDay.get(day);
      if (!d) continue;
      const amount = Number(r.total || 0);
      if (r.is_delivery) d.delivery += amount;
      else if (r.payment_method === "cash") d.cash += amount;
      else if (r.payment_method === "card") d.card += amount;
      else d.other += amount;
    }
    merged.summaryDerivedFromBranchPos = true;
  }

  return merged;
}

/** React Query hook wrapper around `fetchReconciledSalesByDay`. */
export function useReconciledSales(args: Partial<FetchReconciledSalesArgs>) {
  const { restaurantId, dateFrom, dateTo, branchId = null } = args;
  return useQuery({
    queryKey: ["reconciled-sales", restaurantId, dateFrom, dateTo, branchId],
    enabled: !!restaurantId && !!dateFrom && !!dateTo,
    queryFn: () =>
      fetchReconciledSalesByDay({
        restaurantId: restaurantId!,
        dateFrom: dateFrom!,
        dateTo: dateTo!,
        branchId,
      }),
  });
}