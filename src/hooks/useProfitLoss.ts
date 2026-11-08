import { useCachedQuery } from "@/lib/redisCache";
import { dashboardQueryOptions } from "@/lib/query/queryPolicy";
import { qk } from "@/lib/query/queryKeys";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { format, eachDayOfInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths, startOfDay } from "date-fns";
import { getRestaurantDayBoundsUTC, formatZonedYMD } from "@/lib/timezone";
import { filterStaffActiveInPeriod, calculateMonthlyPayroll } from "@/lib/staffUtils";

export interface PLLineItem {
  label: string;
  amount: number;
  percentage: number;
  previousAmount?: number;
  previousPercentage?: number;
  change?: number;
  changePercent?: number;
}

export interface PLSection {
  title: string;
  items: PLLineItem[];
  total: PLLineItem;
}

export interface ProfitLossData {
  period: string;
  periodLabel: string;
  startDate: Date;
  endDate: Date;
  
  // Revenue Section
  revenue: {
    grossSales: number;
    discounts: number;
    refunds: number;
    netSales: number;
  };
  
  // COGS Section
  cogs: {
    foodCost: number;
    beverageCost: number;
    totalCOGS: number;
    foodCostBreakdown: { name: string; amount: number; count: number }[];
    beverageCostBreakdown: { name: string; amount: number; count: number }[];
  };

  
  // Gross Profit
  grossProfit: number;
  grossMargin: number;
  
  // Operating Expenses
  operatingExpenses: {
    laborCost: number;
    laborBreakdown: { name: string; amount: number }[];
    /** Whether labor came from posted payroll records or from staff salary proration. */
    laborSource: "payroll" | "estimated";
    /** Advance recoveries, fines and other payroll deductions inside the period. */
    payrollDeductions: {
      advanceRecovered: number;
      finesDeducted: number;
      otherDeductions: number;
      total: number;
      netPayable: number;
      recordCount: number;
      items: { name: string; gross: number; deductions: number; net: number }[];
    };
    overhead: { name: string; amount: number }[];
    totalOverhead: number;
    otherExpenses: number;
    otherExpenseBreakdown: { name: string; amount: number; count: number }[];
    totalOperating: number;
  };
  
  // Prime Cost
  primeCost: number;
  primeCostPercentage: number;
  
  // Operating & Net Profit
  operatingProfit: number;
  operatingMargin: number;
  netIncome: number;
  netMargin: number;
  
  // Metadata
  transactionCount: number;
  expenseCount: number;
  isEstimated: boolean;
}

export interface PeriodComparison {
  current: ProfitLossData;
  previous: ProfitLossData;
  changes: {
    revenue: number;
    revenuePercent: number;
    grossProfit: number;
    grossProfitPercent: number;
    operatingProfit: number;
    operatingProfitPercent: number;
    netIncome: number;
    netIncomePercent: number;
    primeCost: number;
    primeCostPercent: number;
  };
}

export type PeriodType = "day" | "week" | "month" | "custom";

// Fallback percentages
const FALLBACK_FOOD_COST_PERCENTAGE = 0.28;
const FALLBACK_BEVERAGE_COST_PERCENTAGE = 0.05;

export function useProfitLoss(
  periodType: PeriodType,
  startDate: Date,
  endDate: Date,
  compareWithPrevious = true,
  branchId?: string | null,
  supplierId?: string | null,
) {
  const { restaurant } = useAuth();
  const tz = restaurant?.timezone || "UTC";
  const branchKey = branchId && branchId !== "all" ? branchId : null;
  // "all" = no supplier scoping, "none" = expenses without a supplier.
  const supplierKey = supplierId && supplierId !== "all" ? supplierId : null;
  
  const startStr = formatZonedYMD(startDate, tz);
  const endStr = formatZonedYMD(endDate, tz);
  
  // Calculate previous period
  const getPreviousPeriod = () => {
    switch (periodType) {
      case "day":
        const prevDay = new Date(startDate);
        prevDay.setDate(prevDay.getDate() - 1);
        return { start: prevDay, end: prevDay };
      case "week":
        const prevWeekStart = subWeeks(startDate, 1);
        const prevWeekEnd = subWeeks(endDate, 1);
        return { start: prevWeekStart, end: prevWeekEnd };
      case "month":
        const prevMonthStart = subMonths(startDate, 1);
        const prevMonthEnd = subMonths(endDate, 1);
        return { start: prevMonthStart, end: prevMonthEnd };
      default:
        const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const prevStart = new Date(startDate);
        prevStart.setDate(prevStart.getDate() - daysDiff - 1);
        const prevEnd = new Date(startDate);
        prevEnd.setDate(prevEnd.getDate() - 1);
        return { start: prevStart, end: prevEnd };
    }
  };
  
  const previousPeriod = getPreviousPeriod();
  const prevStartStr = formatZonedYMD(previousPeriod.start, tz);
  const prevEndStr = formatZonedYMD(previousPeriod.end, tz);

  // Fetch sales for current period
  const { data: salesData, isLoading: salesLoading } = useCachedQuery({
    queryKey: qk.profitLoss.entity("sales", { restaurantId: restaurant?.id, branchId: branchKey, extra: [startStr, endStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { start } = getRestaurantDayBoundsUTC(startDate, tz);
      const endDateAdjusted = new Date(endDate);
      endDateAdjusted.setDate(endDateAdjusted.getDate() + 1);
      const { start: endExclusive } = getRestaurantDayBoundsUTC(endDateAdjusted, tz);
      
      let q = db
        .from("sales_transactions")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", endExclusive.toISOString());
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch sales for previous period
  const { data: prevSalesData } = useCachedQuery({
    queryKey: qk.profitLoss.entity("sales-prev", { restaurantId: restaurant?.id, branchId: branchKey, extra: [prevStartStr, prevEndStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id || !compareWithPrevious) return [];
      const { start } = getRestaurantDayBoundsUTC(previousPeriod.start, tz);
      const endDateAdjusted = new Date(previousPeriod.end);
      endDateAdjusted.setDate(endDateAdjusted.getDate() + 1);
      const { start: endExclusive } = getRestaurantDayBoundsUTC(endDateAdjusted, tz);
      
      let q = db
        .from("sales_transactions")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", endExclusive.toISOString());
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && compareWithPrevious,
  });

  // Fetch expenses for current period
  const { data: expensesData, isLoading: expensesLoading } = useCachedQuery({
    queryKey: qk.profitLoss.entity("expenses", { restaurantId: restaurant?.id, branchId: branchKey, extra: [startStr, endStr, supplierKey ?? "all"] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = db
        .from("expenses")
        .select("*, expense_categories(*)")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .gte("expense_date", startStr)
        .lte("expense_date", endStr)
        .eq("approval_status", "approved");
      if (branchKey) q = q.eq("branch_id", branchKey);
      if (supplierKey) {
        q = supplierKey === "none" ? q.is("supplier_id", null) : q.eq("supplier_id", supplierKey);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch expenses for previous period
  const { data: prevExpensesData } = useCachedQuery({
    queryKey: qk.profitLoss.entity("expenses-prev", { restaurantId: restaurant?.id, branchId: branchKey, extra: [prevStartStr, prevEndStr, supplierKey ?? "all"] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id || !compareWithPrevious) return [];
      let q = db
        .from("expenses")
        .select("*, expense_categories(*)")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .gte("expense_date", prevStartStr)
        .lte("expense_date", prevEndStr)
        .eq("approval_status", "approved");
      if (branchKey) q = q.eq("branch_id", branchKey);
      if (supplierKey) {
        q = supplierKey === "none" ? q.is("supplier_id", null) : q.eq("supplier_id", supplierKey);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && compareWithPrevious,
  });

  // Fetch COGS purchases for current period
  const { data: cogsData } = useCachedQuery({
    queryKey: qk.profitLoss.entity("cogs-purchases", { restaurantId: restaurant?.id, branchId: branchKey, extra: [startStr, endStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("daily_cogs_submissions")
        .select("*, cogs_purchases(*)")
        .eq("restaurant_id", restaurant.id)
        .gte("submission_date", startStr)
        .lte("submission_date", endStr)
        .eq("status", "approved");
      if (error) throw error;
      if (!branchKey) return data || [];
      // Filter to submissions whose purchases match the selected branch, and
      // recompute the submission-level cogs using only those purchases.
      return (data || [])
        .map((row: any) => {
          const purchases = (row.cogs_purchases || []).filter(
            (p: any) => p.branch_id === branchKey
          );
          if (purchases.length === 0) return null;
          const cogs = purchases.reduce(
            (s: number, p: any) => s + Number(p.amount || 0),
            0
          );
          return { ...row, cogs_purchases: purchases, cogs };
        })
        .filter(Boolean);
    },
    enabled: !!restaurant?.id,
  });

  // Fetch COGS for previous period
  const { data: prevCogsData } = useCachedQuery({
    queryKey: qk.profitLoss.entity("cogs-prev", { restaurantId: restaurant?.id, branchId: branchKey, extra: [prevStartStr, prevEndStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id || !compareWithPrevious) return [];
      const { data, error } = await db
        .from("daily_cogs_submissions")
        .select("*, cogs_purchases(*)")
        .eq("restaurant_id", restaurant.id)
        .gte("submission_date", prevStartStr)
        .lte("submission_date", prevEndStr)
        .eq("status", "approved");
      if (error) throw error;
      if (!branchKey) return data || [];
      return (data || [])
        .map((row: any) => {
          const purchases = (row.cogs_purchases || []).filter(
            (p: any) => p.branch_id === branchKey
          );
          if (purchases.length === 0) return null;
          const cogs = purchases.reduce(
            (s: number, p: any) => s + Number(p.amount || 0),
            0
          );
          return { ...row, cogs_purchases: purchases, cogs };
        })
        .filter(Boolean);
    },
    enabled: !!restaurant?.id && compareWithPrevious,
  });

  // Fetch overhead allocations
  const { data: overheadData } = useCachedQuery({
    queryKey: qk.profitLoss.entity("overhead", { restaurantId: restaurant?.id, branchId: branchKey }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = db
        .from("overhead_allocation")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true);
      if (branchKey) {
        // Branch-specific items + shared (null) overhead items.
        q = q.or(`branch_id.eq.${branchKey},branch_id.is.null`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch staff for labor cost
  const { data: staffData } = useCachedQuery({
    queryKey: qk.profitLoss.entity("staff", { restaurantId: restaurant?.id, branchId: branchKey, extra: [startStr, endStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = db
        .from("staff")
        .select("name, monthly_salary, hourly_rate, joined_date, termination_date, is_active, assigned_branch_id")
        .eq("restaurant_id", restaurant.id);
      if (branchKey) q = q.eq("assigned_branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return filterStaffActiveInPeriod(data || [], startDate, endDate);
    },
    enabled: !!restaurant?.id,
  });

  // Fetch payroll records overlapping the period so the salary calendar's
  // advance recoveries and fine deductions flow into the P&L / daily profit.
  const usePayrollData = (fromStr: string, toStr: string, key: string) =>
    useCachedQuery({
      queryKey: qk.profitLoss.entity(key, { restaurantId: restaurant?.id, branchId: branchKey, extra: [fromStr, toStr] }),
      ...dashboardQueryOptions(),
      queryFn: async () => {
        if (!restaurant?.id) return [] as any[];
        let q = db
          .from("payroll_records")
          .select(
            "id, amount, gross_wage, deductions, advance_recovered, fines_deducted, period_start, period_end, branch_id, staff:staff_id(name)",
          )
          .eq("restaurant_id", restaurant.id)
          .lte("period_start", toStr)
          .gte("period_end", fromStr);
        if (branchKey) q = q.eq("branch_id", branchKey);
        const { data, error } = await q;
        if (error) throw error;
        return data || [];
      },
      enabled: !!restaurant?.id,
    });

  const { data: payrollData } = usePayrollData(startStr, endStr, "payroll");
  const { data: prevPayrollData } = usePayrollData(
    format(previousPeriod.start, "yyyy-MM-dd"),
    format(previousPeriod.end, "yyyy-MM-dd"),
    "payroll-prev",
  );

  // Fetch closed daily sales summaries + active day-end adjustments so the P&L
  // matches the Daily Profit view (which includes day-end adjustments).
  const useDayEndData = (fromStr: string, toStr: string, key: string, on: boolean) =>
    useCachedQuery({
      queryKey: qk.profitLoss.entity(key, { restaurantId: restaurant?.id, branchId: branchKey, extra: [fromStr, toStr] }),
      ...dashboardQueryOptions(),
      queryFn: async () => {
        if (!restaurant?.id) return { summaries: [] as any[], adjustments: [] as any[] };
        let sq = db
          .from("daily_sales_summary")
          .select("sales_date, total_sales, status, branch_id")
          .eq("restaurant_id", restaurant.id)
          .gte("sales_date", fromStr)
          .lte("sales_date", toStr);
        let aq = db
          .from("day_end_adjustments")
          .select("business_date, amount, scope, reversed_at, branch_id")
          .eq("restaurant_id", restaurant.id)
          .eq("scope", "daily_sales")
          .is("reversed_at", null)
          .gte("business_date", fromStr)
          .lte("business_date", toStr);
        if (branchKey) {
          sq = sq.eq("branch_id", branchKey);
          aq = aq.eq("branch_id", branchKey);
        }
        const [{ data: summaries, error: se }, { data: adjustments, error: ae }] = await Promise.all([sq, aq]);
        if (se) throw se;
        if (ae) throw ae;
        return { summaries: summaries || [], adjustments: adjustments || [] };
      },
      enabled: !!restaurant?.id && on,
    });

  const { data: dayEndData } = useDayEndData(startStr, endStr, "day-end", true);
  const { data: prevDayEndData } = useDayEndData(prevStartStr, prevEndStr, "day-end-prev", compareWithPrevious);

  // Net sales uplift: prefer the closed summary total for a date, else the
  // active day-end adjustment for that date.
  const computeSalesAdjustment = (
    sales: any[] | undefined,
    dayEnd: { summaries: any[]; adjustments: any[] } | undefined,
  ) => {
    if (!dayEnd) return 0;
    const rawByDate = new Map<string, number>();
    (sales || []).forEach((s) => {
      const d = formatZonedYMD(new Date(s.created_at), tz);
      rawByDate.set(d, (rawByDate.get(d) || 0) + Number(s.total || 0));
    });
    const closedByDate = new Map<string, number>();
    (dayEnd.summaries || []).forEach((s) => {
      if (s.status === "closed" || s.status === "approved") {
        closedByDate.set(s.sales_date, (closedByDate.get(s.sales_date) || 0) + Number(s.total_sales || 0));
      }
    });
    const adjByDate = new Map<string, number>();
    (dayEnd.adjustments || []).forEach((a) => {
      adjByDate.set(a.business_date, (adjByDate.get(a.business_date) || 0) + Number(a.amount || 0));
    });
    let delta = 0;
    const dates = new Set<string>([...closedByDate.keys(), ...adjByDate.keys()]);
    dates.forEach((d) => {
      if (closedByDate.has(d)) {
        delta += (closedByDate.get(d) || 0) - (rawByDate.get(d) || 0);
      } else {
        delta += adjByDate.get(d) || 0;
      }
    });
    return delta;
  };

  // Calculate P&L for a period
  const calculatePL = (
    sales: typeof salesData,
    expenses: typeof expensesData,
    cogs: typeof cogsData,
    overhead: typeof overheadData,
    staff: typeof staffData,
    payroll: any[] | undefined,
    periodStart: Date,
    periodEnd: Date,
    label: string,
    salesAdjustment = 0
  ): ProfitLossData => {
    const grossSales = (sales?.reduce((sum, s) => sum + Number(s.total || 0), 0) || 0) + salesAdjustment;
    const discounts = 0;
    const refunds = 0;
    const netSales = grossSales - discounts - refunds;


    // Calculate COGS from approved submissions
    let foodCost = 0;
    let beverageCost = 0;
    const foodMap = new Map<string, { name: string; amount: number; count: number }>();
    const beverageMap = new Map<string, { name: string; amount: number; count: number }>();

    if (cogs && cogs.length > 0) {
      foodCost = cogs.reduce((sum, c) => sum + Number(c.cogs || 0), 0);

      // Build a per-line breakdown for the info badges (food vs beverage buckets)
      (cogs as any[]).forEach((submission) => {
        const purchases = (submission?.cogs_purchases || []) as any[];
        purchases.forEach((p) => {
          const type = String(p?.item_type || "Uncategorized");
          const name = p?.supplier_name ? `${type} · ${p.supplier_name}` : type;
          // Submission-level cogs (which feeds foodCost) covers every purchase line,
          // so all lines belong to the food bucket to keep the badge total consistent.
          const target = foodMap;
          const existing = target.get(name);
          const amount = Number(p?.amount || 0);
          if (existing) {
            existing.amount += amount;
            existing.count += 1;
          } else {
            target.set(name, { name, amount, count: 1 });
          }
        });
      });
    } else {
      // Fallback estimation
      foodCost = netSales * FALLBACK_FOOD_COST_PERCENTAGE;
      beverageCost = netSales * FALLBACK_BEVERAGE_COST_PERCENTAGE;
      foodMap.set("Estimated food cost", {
        name: `Estimated (${(FALLBACK_FOOD_COST_PERCENTAGE * 100).toFixed(0)}% of net sales)`,
        amount: foodCost,
        count: 0,
      });
      beverageMap.set("Estimated beverage cost", {
        name: `Estimated (${(FALLBACK_BEVERAGE_COST_PERCENTAGE * 100).toFixed(0)}% of net sales)`,
        amount: beverageCost,
        count: 0,
      });
    }

    const foodCostBreakdown = Array.from(foodMap.values()).sort((a, b) => b.amount - a.amount);
    const beverageCostBreakdown = Array.from(beverageMap.values()).sort((a, b) => b.amount - a.amount);

    
    const totalCOGS = foodCost + beverageCost;
    const grossProfit = netSales - totalCOGS;
    const grossMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

    // Calculate days in period for overhead allocation
    const daysDiff = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Calculate labor cost
    const monthlyPayroll = staff ? calculateMonthlyPayroll(staff) : 0;
    const dailyLabor = monthlyPayroll / 30;
    const laborCost = dailyLabor * daysDiff;

    // Per-staff prorated labor breakdown (for the info badge on the P&L row)
    const laborBreakdown = (staff || [])
      .map((s) => {
        const salary = Number(s.monthly_salary) || 0;
        const hourlyEstimate = Number(s.hourly_rate) * 160 || 0;
        const monthly = salary > 0 ? salary : hourlyEstimate;
        return {
          name: (s as any).name || (s as any).full_name || "Unknown",
          amount: (monthly / 30) * daysDiff,
        };
      })
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    // Payroll actuals: when payroll exists for the period it replaces the
    // salary proration, and its deductions are surfaced separately.
    // Each payroll row is prorated to the days it overlaps the selected range,
    // so a monthly/half-month record does not land entirely on a single day.
    const payrollRows = payroll || [];
    const dayMs = 1000 * 60 * 60 * 24;
    const payrollOverlapRatio = (p: any) => {
      const ps = p.period_start ? new Date(`${String(p.period_start).slice(0, 10)}T00:00:00`) : null;
      const pe = p.period_end ? new Date(`${String(p.period_end).slice(0, 10)}T00:00:00`) : null;
      if (!ps || !pe || isNaN(ps.getTime()) || isNaN(pe.getTime())) return 1;
      const rowDays = Math.floor((pe.getTime() - ps.getTime()) / dayMs) + 1;
      if (rowDays <= 0) return 1;
      const start = Math.max(ps.getTime(), periodStart.getTime());
      const end = Math.min(pe.getTime(), periodEnd.getTime());
      const overlapDays = Math.floor((end - start) / dayMs) + 1;
      if (overlapDays <= 0) return 0;
      return Math.min(overlapDays / rowDays, 1);
    };
    const prorated = payrollRows.map((p) => {
      const ratio = payrollOverlapRatio(p);
      return {
        row: p,
        ratio,
        gross: Number(p.gross_wage ?? p.amount ?? 0) * ratio,
        deductions: Number(p.deductions || 0) * ratio,
        advance: Number(p.advance_recovered || 0) * ratio,
        fines: Number(p.fines_deducted || 0) * ratio,
        net: Number(p.amount || 0) * ratio,
      };
    });
    const payrollGross = prorated.reduce((sum, p) => sum + p.gross, 0);
    const advanceRecovered = prorated.reduce((s2, p) => s2 + p.advance, 0);
    const finesDeducted = prorated.reduce((s2, p) => s2 + p.fines, 0);
    const totalDeductions = prorated.reduce((s2, p) => s2 + p.deductions, 0);
    const otherDeductions = Math.max(totalDeductions - advanceRecovered - finesDeducted, 0);
    const netPayable = prorated.reduce((s2, p) => s2 + p.net, 0);
    const payrollItems = prorated
      .map((p) => ({
        name: (p.row as any).staff?.name || "Unknown",
        gross: p.gross,
        deductions: p.deductions,
        net: p.net,
      }))
      .filter((r) => r.gross > 0 || r.deductions > 0)
      .sort((a, b) => b.gross - a.gross);


    const usePayrollActuals = payrollRows.length > 0 && payrollGross > 0;
    const effectiveLaborCost = usePayrollActuals ? payrollGross : laborCost;
    const effectiveLaborBreakdown = usePayrollActuals
      ? payrollItems.map((p) => ({ name: p.name, amount: p.gross }))
      : laborBreakdown;

    // Calculate overhead
    const monthlyOverhead = overhead?.reduce((sum, o) => sum + Number(o.monthly_amount || 0), 0) || 0;
    const dailyOverhead = monthlyOverhead / 30;
    const overheadItems = overhead?.map(o => ({
      name: o.name,
      amount: (Number(o.monthly_amount) / 30) * daysDiff,
    })) || [];
    const totalOverhead = dailyOverhead * daysDiff;

    // Other expenses (non-COGS)
    const otherExpenses = expenses?.reduce((sum, e) => sum + Number(e.amount || 0), 0) || 0;

    // Breakdown of other expenses by category (for the info badge on the P&L row)
    const otherExpenseMap = new Map<string, { name: string; amount: number; count: number }>();
    for (const e of expenses || []) {
      const name =
        (e as any).expense_categories?.name ||
        (e as any).description ||
        "Uncategorized";
      const existing = otherExpenseMap.get(name);
      const amount = Number((e as any).amount || 0);
      if (existing) {
        existing.amount += amount;
        existing.count += 1;
      } else {
        otherExpenseMap.set(name, { name, amount, count: 1 });
      }
    }
    const otherExpenseBreakdown = Array.from(otherExpenseMap.values()).sort(
      (a, b) => b.amount - a.amount,
    );

    const totalOperating = effectiveLaborCost + totalOverhead + otherExpenses;
    const primeCost = totalCOGS + effectiveLaborCost;
    const primeCostPercentage = netSales > 0 ? (primeCost / netSales) * 100 : 0;

    const operatingProfit = grossProfit - totalOperating + totalCOGS;
    const operatingProfitActual = netSales - primeCost - totalOverhead - otherExpenses;
    const operatingMargin = netSales > 0 ? (operatingProfitActual / netSales) * 100 : 0;

    const netIncome = operatingProfitActual;
    const netMargin = netSales > 0 ? (netIncome / netSales) * 100 : 0;

    return {
      period: `${format(periodStart, "yyyy-MM-dd")}_${format(periodEnd, "yyyy-MM-dd")}`,
      periodLabel: label,
      startDate: periodStart,
      endDate: periodEnd,
      revenue: {
        grossSales,
        discounts,
        refunds,
        netSales,
      },
      cogs: {
        foodCost,
        beverageCost,
        totalCOGS,
        foodCostBreakdown,
        beverageCostBreakdown,
      },

      grossProfit,
      grossMargin,
      operatingExpenses: {
        laborCost: effectiveLaborCost,
        laborBreakdown: effectiveLaborBreakdown,
        laborSource: usePayrollActuals ? "payroll" : "estimated",
        payrollDeductions: {
          advanceRecovered,
          finesDeducted,
          otherDeductions,
          total: totalDeductions,
          netPayable,
          recordCount: payrollRows.length,
          items: payrollItems,
        },
        overhead: overheadItems,
        totalOverhead,
        otherExpenses,
        otherExpenseBreakdown,
        totalOperating,
      },
      primeCost,
      primeCostPercentage,
      operatingProfit: operatingProfitActual,
      operatingMargin,
      netIncome,
      netMargin,
      transactionCount: sales?.length || 0,
      expenseCount: expenses?.length || 0,
      isEstimated: !cogs || cogs.length === 0,
    };
  };

  // Generate period label
  const getPeriodLabel = (start: Date, end: Date): string => {
    if (periodType === "day") {
      return format(start, "MMM d, yyyy");
    } else if (periodType === "week") {
      return `Week of ${format(start, "MMM d")}`;
    } else if (periodType === "month") {
      return format(start, "MMMM yyyy");
    }
    return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`;
  };

  const isLoading = salesLoading || expensesLoading;

  const currentPL = calculatePL(
    salesData || [],
    expensesData || [],
    cogsData || [],
    overheadData || [],
    staffData || [],
    payrollData || [],
    startDate,
    endDate,
    getPeriodLabel(startDate, endDate),
    computeSalesAdjustment(salesData, dayEndData)

  );

  const previousPL = compareWithPrevious
    ? calculatePL(
        prevSalesData || [],
        prevExpensesData || [],
        prevCogsData || [],
        overheadData || [],
        staffData || [],
        prevPayrollData || [],
        previousPeriod.start,
        previousPeriod.end,
        getPeriodLabel(previousPeriod.start, previousPeriod.end),
        computeSalesAdjustment(prevSalesData, prevDayEndData)

      )
    : null;

  // Calculate changes
  const calculateChange = (current: number, previous: number) => {
    const change = current - previous;
    const percent = previous !== 0 ? (change / Math.abs(previous)) * 100 : current !== 0 ? 100 : 0;
    return { change, percent };
  };

  const comparison: PeriodComparison | null = previousPL
    ? {
        current: currentPL,
        previous: previousPL,
        changes: {
          revenue: currentPL.revenue.netSales - previousPL.revenue.netSales,
          revenuePercent: calculateChange(currentPL.revenue.netSales, previousPL.revenue.netSales).percent,
          grossProfit: currentPL.grossProfit - previousPL.grossProfit,
          grossProfitPercent: calculateChange(currentPL.grossProfit, previousPL.grossProfit).percent,
          operatingProfit: currentPL.operatingProfit - previousPL.operatingProfit,
          operatingProfitPercent: calculateChange(currentPL.operatingProfit, previousPL.operatingProfit).percent,
          netIncome: currentPL.netIncome - previousPL.netIncome,
          netIncomePercent: calculateChange(currentPL.netIncome, previousPL.netIncome).percent,
          primeCost: currentPL.primeCost - previousPL.primeCost,
          primeCostPercent: calculateChange(currentPL.primeCost, previousPL.primeCost).percent,
        },
      }
    : null;

  return {
    current: currentPL,
    previous: previousPL,
    comparison,
    isLoading,
  };
}

// Convenience hooks for common periods
export function useDailyPL(date: Date, branchId?: string | null, supplierId?: string | null) {
  return useProfitLoss("day", date, date, true, branchId, supplierId);
}

export function useWeeklyPL(date: Date, branchId?: string | null, supplierId?: string | null) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  // Normalize to midnight to prevent timezone calculation issues
  const weekEnd = startOfDay(endOfWeek(date, { weekStartsOn: 1 }));
  return useProfitLoss("week", weekStart, weekEnd, true, branchId, supplierId);
}

export function useMonthlyPL(date: Date, branchId?: string | null, supplierId?: string | null) {
  const monthStart = startOfMonth(date);
  // Normalize to midnight to prevent timezone calculation issues
  const monthEnd = startOfDay(endOfMonth(date));
  return useProfitLoss("month", monthStart, monthEnd, true, branchId, supplierId);
}
