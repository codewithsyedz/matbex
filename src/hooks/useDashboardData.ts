import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { format, differenceInDays } from "date-fns";
import { getEffectiveStartDate, RESTAURANT_START_DATE } from "@/lib/constants";
import { getRestaurantDayBoundsUTC, getTenantTodayDate } from "@/lib/timezone";
import { cachedQueryFn, CACHE_TTL } from "@/lib/redisCache";
import { fetchReconciledSalesByDay } from "@/lib/reconciledSales";
import { qk } from "@/lib/query/queryKeys";
import { dashboardQueryOptions, referenceQueryOptions } from "@/lib/query/queryPolicy";

interface ShiftData {
  id: string;
  cashier: string;
  startTime: string;
  endTime?: string;
  status: "open" | "closing" | "closed";
  expectedCash?: number;
  countedCash?: number;
  variance?: number;
  varianceStatus?: "perfect" | "minor" | "investigate";
  drawer: string;
  meta: {
    opened_at: string;
    closed_at: string | null;
    template_id: string | null;
  };
}

interface DateRangeFilter {
  from: Date;
  to: Date;
}

interface UseDashboardDataOptions {
  dateRange?: DateRangeFilter;
  comparisonRange?: DateRangeFilter | null;
}

// Cache policy (staleTime tiers, focus-refetch disabled, keepPreviousData)
// lives in @/lib/query/queryPolicy so every dashboard query behaves the same.

export function computeBounds(
  restaurantId: string | undefined,
  timezone: string,
  dateRange?: DateRangeFilter,
) {
  const today = getTenantTodayDate(timezone);
  const dateFrom = dateRange?.from || today;
  const dateTo = dateRange?.to || today;

  const effectiveFrom = getEffectiveStartDate(dateFrom);
  const effectiveTo = dateTo < RESTAURANT_START_DATE ? RESTAURANT_START_DATE : dateTo;
  const startBounds = getRestaurantDayBoundsUTC(effectiveFrom, timezone);
  const endBounds = getRestaurantDayBoundsUTC(effectiveTo, timezone);
  return {
    restaurantId,
    startDateUTC: startBounds.start.toISOString(),
    endDateUTC: endBounds.endExclusive.toISOString(),
    startDate: format(effectiveFrom, "yyyy-MM-dd"),
    endDate: format(effectiveTo, "yyyy-MM-dd"),
    daysInRange: Math.max(1, differenceInDays(effectiveTo, effectiveFrom) + 1),
  };
}

export function useDashboardData(options?: UseDashboardDataOptions) {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();
  const queryClient = useQueryClient();
  const restaurantId = restaurant?.id;
  const timezone = restaurant?.timezone || "Asia/Riyadh";

  const bounds = useMemo(
    () => computeBounds(restaurantId, timezone, options?.dateRange),
    [restaurantId, timezone, options?.dateRange?.from?.getTime(), options?.dateRange?.to?.getTime()],
  );

  const compBounds = useMemo(() => {
    if (!options?.comparisonRange || !restaurantId) return null;
    return computeBounds(restaurantId, timezone, options.comparisonRange);
  }, [restaurantId, timezone, options?.comparisonRange?.from?.getTime(), options?.comparisonRange?.to?.getTime()]);

  // Independent queries - each renders its own section as soon as it resolves
  const shiftsQ = useQuery({
    queryKey: qk.dashboard.entity("shifts", { restaurantId, branchId: activeBranchId }),
    enabled: !!restaurantId,
    ...dashboardQueryOptions(),
    queryFn: async () => {
      let q = supabase
        .from("shifts")
        .select(`id, status, opening_float, expected_cash, counted_cash, variance, opened_at, closed_at, cashier_user_id, cashier_staff_id, drawer_id, template_id`)
        .eq("restaurant_id", restaurantId!)
        .order("opened_at", { ascending: false })
        .limit(10);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const drawersQ = useQuery({
    queryKey: qk.dashboard.entity("drawers", { restaurantId, branchId: activeBranchId }),
    enabled: !!restaurantId,
    ...referenceQueryOptions(),
    queryFn: async () => {
      let q = supabase
        .from("drawers")
        .select("id, name")
        .eq("restaurant_id", restaurantId!);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data } = await q;
      return data || [];
    },
  });

  // Server-side aggregation - returns a single row instead of every transaction.
  const salesQ = useQuery({
    queryKey: qk.dashboard.entity("salesAgg", { restaurantId, branchId: activeBranchId, extra: [bounds.startDateUTC, bounds.endDateUTC] }),
    enabled: !!restaurantId,
    ...dashboardQueryOptions(),
    queryFn: cachedQueryFn(
      qk.dashboard.entity("salesAgg", { restaurantId, branchId: activeBranchId, extra: [bounds.startDateUTC, bounds.endDateUTC] }),
      CACHE_TTL.SHORT,
      async () => {
      const { data, error } = await (supabase as any).rpc("dashboard_sales_summary", {
        p_restaurant_id: restaurantId,
        p_start: bounds.startDateUTC,
        p_end: bounds.endDateUTC,
        p_branch_id: activeBranchId,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as null | {
        net_sales: number;
        total_transactions: number;
        cash_sales: number;
        cash_transactions: number;
        card_sales: number;
        card_transactions: number;
        paid_sales: number;
        unpaid_sales: number;
      };
    }),
  });

  const expensesQ = useQuery({
    queryKey: qk.dashboard.entity("expensesAgg", { restaurantId, branchId: activeBranchId, extra: [bounds.startDate, bounds.endDate] }),
    enabled: !!restaurantId,
    ...dashboardQueryOptions(),
    queryFn: cachedQueryFn(
      qk.dashboard.entity("expensesAgg", { restaurantId, branchId: activeBranchId, extra: [bounds.startDate, bounds.endDate] }),
      CACHE_TTL.SHORT,
      async () => {
      const { data, error } = await (supabase as any).rpc("dashboard_expense_summary", {
        p_restaurant_id: restaurantId,
        p_start_date: bounds.startDate,
        p_end_date: bounds.endDate,
        p_branch_id: activeBranchId,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as null | {
        total_expenses: number;
        total_count: number;
        paid_expenses: number;
        unpaid_expenses: number;
      };
    }),
  });

  // Reconciled sales (closed-day summary override + active day-end adjustments)
  const reconciledQ = useQuery({
    queryKey: qk.dashboard.entity("reconciledSales", { restaurantId, branchId: activeBranchId, extra: [bounds.startDate, bounds.endDate] }),
    enabled: !!restaurantId,
    ...dashboardQueryOptions(),
    queryFn: () =>
      fetchReconciledSalesByDay({
        restaurantId: restaurantId!,
        dateFrom: bounds.startDate,
        dateTo: bounds.endDate,
        branchId: activeBranchId,
      }),
  });

  // VAT split from POS receipts (gross vs tax) so the dashboard can express
  // both VAT-inclusive gross sales and VAT-exclusive net sales.
  const vatQ = useQuery({
    queryKey: qk.dashboard.entity("vatSplit", { restaurantId, branchId: activeBranchId, extra: [bounds.startDateUTC, bounds.endDateUTC] }),
    enabled: !!restaurantId,
    ...dashboardQueryOptions(),
    queryFn: async () => {
      let q = supabase
        .from("sales_transactions")
        .select("total, tax")
        .eq("restaurant_id", restaurantId!)
        .gte("created_at", bounds.startDateUTC)
        .lt("created_at", bounds.endDateUTC);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as any[];
      return rows.reduce(
        (acc, r) => ({
          gross: acc.gross + Number(r.total || 0),
          vat: acc.vat + Number(r.tax || 0),
        }),
        { gross: 0, vat: 0 },
      );
    },
  });

  const compReconciledQ = useQuery({
    queryKey: qk.dashboard.entity("compReconciledSales", { restaurantId, branchId: activeBranchId, extra: [compBounds?.startDate, compBounds?.endDate] }),
    enabled: !!restaurantId && !!compBounds,
    ...dashboardQueryOptions(),
    queryFn: () =>
      fetchReconciledSalesByDay({
        restaurantId: restaurantId!,
        dateFrom: compBounds!.startDate,
        dateTo: compBounds!.endDate,
        branchId: activeBranchId,
      }),
  });

  const closedShiftsQ = useQuery({
    queryKey: qk.dashboard.entity("closedShifts", { restaurantId, branchId: activeBranchId, extra: [bounds.startDateUTC, bounds.endDateUTC] }),
    enabled: !!restaurantId,
    ...dashboardQueryOptions(),
    queryFn: cachedQueryFn(
      qk.dashboard.entity("closedShifts", { restaurantId, branchId: activeBranchId, extra: [bounds.startDateUTC, bounds.endDateUTC] }),
      CACHE_TTL.SHORT,
      async () => {
      let q = supabase
        .from("shifts")
        .select("variance")
        .eq("restaurant_id", restaurantId!)
        .eq("status", "closed")
        .gte("closed_at", bounds.startDateUTC)
        .lt("closed_at", bounds.endDateUTC);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data } = await q;
      return data || [];
    }),
  });

  const staffCountQ = useQuery({
    queryKey: qk.dashboard.entity("staffCount", { restaurantId, branchId: activeBranchId }),
    enabled: !!restaurantId,
    ...referenceQueryOptions(),
    queryFn: async () => {
      let q = supabase
        .from("staff")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId!)
        .eq("is_active", true);
      if (activeBranchId) q = q.eq("assigned_branch_id", activeBranchId);
      const { count } = await q;
      return count || 0;
    },
  });

  // Day-end (11–11) cash variance recorded by the branch's day close
  const dayEndVarianceQ = useQuery({
    queryKey: qk.dashboard.entity("dayEndVariance", { restaurantId, branchId: activeBranchId, extra: [bounds.startDate, bounds.endDate] }),
    enabled: !!restaurantId,
    ...dashboardQueryOptions(),
    queryFn: async () => {
      let q = supabase
        .from("daily_sales_summary")
        .select("sales_date, variance_amount, variance_status")
        .eq("restaurant_id", restaurantId!)
        .gte("sales_date", bounds.startDate)
        .lte("sales_date", bounds.endDate);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // Resolve cashier names only after shifts arrive
  const shiftsData = shiftsQ.data || [];
  const staffIds = useMemo(
    () => [...new Set(shiftsData.map((s: any) => s.cashier_staff_id).filter(Boolean))],
    [shiftsData],
  );
  const cashierIds = useMemo(
    () => [...new Set(shiftsData.filter((s: any) => !s.cashier_staff_id).map((s: any) => s.cashier_user_id).filter(Boolean))],
    [shiftsData],
  );

  const staffNamesQ = useQuery({
    queryKey: qk.dashboard.entity("staffNames", { restaurantId, extra: [staffIds.sort().join(",")] }),
    enabled: !!restaurantId && staffIds.length > 0,
    ...referenceQueryOptions(),
    queryFn: async () => {
      const { data } = await supabase.from("staff").select("id, name").in("id", staffIds as string[]);
      return data || [];
    },
  });

  const profilesQ = useQuery({
    queryKey: qk.dashboard.entity("cashierProfiles", { restaurantId, extra: [cashierIds.sort().join(",")] }),
    enabled: !!restaurantId && cashierIds.length > 0,
    ...referenceQueryOptions(),
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", cashierIds as string[]);
      return data || [];
    },
  });

  // Comparison aggregations (only when requested)
  const compSalesQ = useQuery({
    queryKey: qk.dashboard.entity("compSalesAgg", { restaurantId, branchId: activeBranchId, extra: [compBounds?.startDateUTC, compBounds?.endDateUTC] }),
    enabled: !!restaurantId && !!compBounds,
    ...dashboardQueryOptions(),
    queryFn: cachedQueryFn(
      qk.dashboard.entity("compSalesAgg", { restaurantId, branchId: activeBranchId, extra: [compBounds?.startDateUTC, compBounds?.endDateUTC] }),
      CACHE_TTL.MEDIUM,
      async () => {
      const { data, error } = await (supabase as any).rpc("dashboard_sales_summary", {
        p_restaurant_id: restaurantId,
        p_start: compBounds!.startDateUTC,
        p_end: compBounds!.endDateUTC,
        p_branch_id: activeBranchId,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as null | {
        net_sales: number;
        total_transactions: number;
      };
    }),
  });

  const compExpensesQ = useQuery({
    queryKey: qk.dashboard.entity("compExpensesAgg", { restaurantId, branchId: activeBranchId, extra: [compBounds?.startDate, compBounds?.endDate] }),
    enabled: !!restaurantId && !!compBounds,
    ...dashboardQueryOptions(),
    queryFn: cachedQueryFn(
      qk.dashboard.entity("compExpensesAgg", { restaurantId, branchId: activeBranchId, extra: [compBounds?.startDate, compBounds?.endDate] }),
      CACHE_TTL.MEDIUM,
      async () => {
      const { data, error } = await (supabase as any).rpc("dashboard_expense_summary", {
        p_restaurant_id: restaurantId,
        p_start_date: compBounds!.startDate,
        p_end_date: compBounds!.endDate,
        p_branch_id: activeBranchId,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as null | { total_expenses: number; total_count: number };
    }),
  });

  // Realtime invalidation
  useEffect(() => {
    if (!restaurantId) return;
    const invalidate = (entities: string[]) =>
      entities.forEach((entity) =>
        queryClient.invalidateQueries({ queryKey: qk.dashboard.entityAll(entity, restaurantId) }),
      );

    const ch1 = supabase
      .channel("dashboard-shifts")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts", filter: `restaurant_id=eq.${restaurantId}` },
        () => invalidate(["shifts", "closedShifts"]))
      .subscribe();
    const ch2 = supabase
      .channel("dashboard-cash-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_events", filter: `restaurant_id=eq.${restaurantId}` },
        () => invalidate(["closedShifts", "shifts"]))
      .subscribe();
    const ch3 = supabase
      .channel("dashboard-sales")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_transactions", filter: `restaurant_id=eq.${restaurantId}` },
        () => invalidate(["salesAgg", "compSalesAgg", "reconciledSales", "compReconciledSales", "vatSplit"]))
      .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      supabase.removeChannel(ch3);
    };
  }, [restaurantId, queryClient]);

  // Derived data
  const drawerMap = useMemo(
    () => new Map((drawersQ.data || []).map((d: any) => [d.id, d.name])),
    [drawersQ.data],
  );
  const staffMap = useMemo(
    () => new Map((staffNamesQ.data || []).map((s: any) => [s.id, s.name])),
    [staffNamesQ.data],
  );
  const profileMap = useMemo(
    () => new Map((profilesQ.data || []).map((p: any) => [p.id, p.full_name || "Unknown"])),
    [profilesQ.data],
  );

  const shifts: ShiftData[] = useMemo(() => {
    return shiftsData.map((shift: any) => {
      const openedAt = new Date(shift.opened_at);
      const closedAt = shift.closed_at ? new Date(shift.closed_at) : null;
      let varianceStatus: "perfect" | "minor" | "investigate" | undefined;
      if (shift.variance !== null && shift.variance !== undefined) {
        const abs = Math.abs(shift.variance);
        if (abs === 0) varianceStatus = "perfect";
        else if (abs <= 20) varianceStatus = "minor";
        else varianceStatus = "investigate";
      }
      const cashierName = shift.cashier_staff_id
        ? (staffMap.get(shift.cashier_staff_id) as string) || "Unknown Staff"
        : (profileMap.get(shift.cashier_user_id) as string) || "Unknown";
      return {
        id: shift.id,
        cashier: cashierName,
        startTime: openedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        endTime: closedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        status: shift.status,
        expectedCash: shift.expected_cash || shift.opening_float,
        countedCash: shift.counted_cash || undefined,
        variance: shift.variance ?? undefined,
        varianceStatus,
        drawer: (drawerMap.get(shift.drawer_id) as string) || "Unknown Drawer",
        meta: {
          opened_at: shift.opened_at,
          closed_at: shift.closed_at,
          template_id: shift.template_id ?? null,
        },
      } as ShiftData;
    });
  }, [shiftsData, drawerMap, staffMap, profileMap]);

  const metrics = useMemo(() => {
    // Aggregations come pre-computed from the database now.
    const sAgg = (salesQ.data ?? null) as null | {
      net_sales: number; total_transactions: number;
      cash_sales: number; cash_transactions: number;
      card_sales: number; card_transactions: number;
      paid_sales: number; unpaid_sales: number;
    };
    const eAgg = (expensesQ.data ?? null) as null | {
      total_expenses: number; total_count: number;
      paid_expenses: number; unpaid_expenses: number;
    };
    const closedShiftsInRange = closedShiftsQ.data || [];

    // Persisted (JSON) cache restores Maps as plain objects — normalize.
    const asMap = <V,>(v: unknown): Map<string, V> => {
      if (v instanceof Map) return v as Map<string, V>;
      if (Array.isArray(v)) return new Map(v as [string, V][]);
      if (v && typeof v === "object") return new Map(Object.entries(v as Record<string, V>));
      return new Map<string, V>();
    };
    const recRaw = (reconciledQ.data ?? null) as null | {
      total: number;
      adjustmentsByDay: unknown;
      summaryByDay: unknown;
      summaryDetailByDay: unknown;
    };
    const rec = recRaw
      ? {
          total: recRaw.total,
          adjustmentsByDay: asMap<number>(recRaw.adjustmentsByDay),
          summaryByDay: asMap<unknown>(recRaw.summaryByDay),
          summaryDetailByDay: asMap<{ cash: number; card: number }>(recRaw.summaryDetailByDay),
        }
      : null;
    const rawPosSales = Number(sAgg?.net_sales ?? 0);
    // Reconciled total = closed-day summary override + active day-end
    // adjustments, falling back to raw POS while the query is in flight.
    const netSales = rec ? rec.total : rawPosSales;
    const reconciliationDelta = netSales - rawPosSales;

    // VAT split. Sale totals are VAT-inclusive (gross). The effective VAT rate
    // is derived from actual POS receipts so mixed/zero-rated items stay exact;
    // it is then applied to the reconciled gross total.
    const vatAgg = (vatQ.data ?? null) as null | { gross: number; vat: number };
    const posGross = Number(vatAgg?.gross ?? 0);
    const posVat = Number(vatAgg?.vat ?? 0);
    const effectiveVatRate = posGross > 0 ? posVat / posGross : 0; // share of gross
    const grossSales = netSales; // VAT-inclusive
    const vatAmount = grossSales * effectiveVatRate;
    const netExVatSales = grossSales - vatAmount;
    const adjustmentsTotal = rec
      ? Array.from(rec.adjustmentsByDay.values()).reduce((s, v) => s + v, 0)
      : 0;
    const closedDaysCount = rec ? rec.summaryByDay.size : 0;
    const totalTransactions = Number(sAgg?.total_transactions ?? 0);
    const averageSale = totalTransactions > 0 ? netSales / totalTransactions : 0;
    const dailyAvgSale = bounds.daysInRange > 0 ? netSales / bounds.daysInRange : 0;
    // Prefer the reconciled payment split when closed-day summaries exist.
    const recSplit = rec
      ? Array.from(rec.summaryDetailByDay.values()).reduce(
          (acc, d) => ({ cash: acc.cash + d.cash, card: acc.card + d.card }),
          { cash: 0, card: 0 },
        )
      : null;
    const hasRecSplit = !!rec && rec.summaryDetailByDay.size > 0 && (recSplit!.cash + recSplit!.card) > 0;
    const cashSales = hasRecSplit ? recSplit!.cash : Number(sAgg?.cash_sales ?? 0);
    const cardSales = hasRecSplit ? recSplit!.card : Number(sAgg?.card_sales ?? 0);
    const cashTransactions = Number(sAgg?.cash_transactions ?? 0);
    const cardTransactions = Number(sAgg?.card_transactions ?? 0);
    const paidSales = Number(sAgg?.paid_sales ?? 0);
    const unpaidSales = Number(sAgg?.unpaid_sales ?? 0);

    const totalExpenses = Number(eAgg?.total_expenses ?? 0);
    const paidExpenses = Number(eAgg?.paid_expenses ?? 0);
    const unpaidExpenses = Number(eAgg?.unpaid_expenses ?? 0);
    const totalExpenseCount = Number(eAgg?.total_count ?? 0);
    const averageExpense = totalExpenseCount > 0 ? totalExpenses / totalExpenseCount : 0;
    const dailyAvgExpense = bounds.daysInRange > 0 ? totalExpenses / bounds.daysInRange : 0;

    // Cash variance combines shift-close variances with the branch's day-end
    // (11–11) close variance. Both are signed so they can offset each other;
    // the card shows the net figure plus its two components.
    const shiftVariance = closedShiftsInRange.reduce((s: number, x: any) => s + Number(x.variance || 0), 0);
    const dayEndRows = (dayEndVarianceQ.data || []) as any[];
    const dayEndVariance = dayEndRows.reduce((s: number, x: any) => s + Number(x.variance_amount || 0), 0);
    const unresolvedVarianceDays = dayEndRows.filter(
      (x: any) => Number(x.variance_amount || 0) !== 0 && x.variance_status && x.variance_status !== "resolved",
    ).length;
    const totalVariance = shiftVariance + dayEndVariance;

    const compSAgg = (compSalesQ.data ?? null) as null | { net_sales: number; total_transactions: number };
    const compEAgg = (compExpensesQ.data ?? null) as null | { total_expenses: number; total_count: number };

    let comparisonNetSales: number | null = null;
    let comparisonTotalExpenses: number | null = null;
    let comparisonAvgSale: number | null = null;
    let comparisonAvgExpense: number | null = null;
    let comparisonTransactions: number | null = null;
    let comparisonExpenseCount: number | null = null;

    if (compBounds && compSAgg && compEAgg) {
      comparisonNetSales = compReconciledQ.data
        ? compReconciledQ.data.total
        : Number(compSAgg.net_sales ?? 0);
      comparisonTransactions = Number(compSAgg.total_transactions ?? 0);
      comparisonAvgSale = comparisonTransactions > 0 ? comparisonNetSales / comparisonTransactions : 0;
      comparisonTotalExpenses = Number(compEAgg.total_expenses ?? 0);
      comparisonExpenseCount = Number(compEAgg.total_count ?? 0);
      comparisonAvgExpense = comparisonExpenseCount > 0 ? comparisonTotalExpenses / comparisonExpenseCount : 0;
    }

    const netSalesChange = comparisonNetSales !== null && comparisonNetSales > 0
      ? ((netSales - comparisonNetSales) / comparisonNetSales) * 100
      : 0;

    const openShiftsCount = shiftsData.filter((s: any) => s.status === "open").length;

    return {
      netSales,
      netSalesChange,
      grossSales,
      vatAmount,
      netExVatSales,
      effectiveVatRate,
      rawPosSales,
      reconciliationDelta,
      adjustmentsTotal,
      closedDaysCount,
      cashVariance: totalVariance,
      shiftVariance,
      dayEndVariance,
      unresolvedVarianceDays,
      varianceChange: 0,
      activeStaff: staffCountQ.data || 0,
      openShiftsCount,
      averageSale,
      averageExpense,
      dailyAvgSale,
      dailyAvgExpense,
      totalTransactions,
      totalExpenseCount,
      totalExpenses,
      paidExpenses,
      unpaidExpenses,
      daysInRange: bounds.daysInRange,
      cashSales,
      cardSales,
      cashTransactions,
      cardTransactions,
      paidSales,
      unpaidSales,
      comparisonNetSales,
      comparisonTotalExpenses,
      comparisonAvgSale,
      comparisonAvgExpense,
      comparisonTransactions,
      comparisonExpenseCount,
    };
  }, [salesQ.data, expensesQ.data, closedShiftsQ.data, compSalesQ.data, compExpensesQ.data, staffCountQ.data, dayEndVarianceQ.data, vatQ.data, shiftsData, bounds.daysInRange, compBounds, reconciledQ.data, compReconciledQ.data]);

  // Granular loading flags so each section can render independently
  const loading = {
    shifts: shiftsQ.isLoading,
    sales: salesQ.isLoading,
    expenses: expensesQ.isLoading,
    variance: closedShiftsQ.isLoading || dayEndVarianceQ.isLoading,
    staff: staffCountQ.isLoading,
  };

  // Aggregate fallback (true while ANY core query is still on first load)
  const isLoading = shiftsQ.isLoading || salesQ.isLoading || expensesQ.isLoading;

  const refetch = () => {
    shiftsQ.refetch();
    salesQ.refetch();
    expensesQ.refetch();
    closedShiftsQ.refetch();
    staffCountQ.refetch();
    reconciledQ.refetch();
    dayEndVarianceQ.refetch();
    if (compBounds) {
      compSalesQ.refetch();
      compExpensesQ.refetch();
      compReconciledQ.refetch();
    }
  };

  return { shifts, metrics, isLoading, loading, refetch };
}
