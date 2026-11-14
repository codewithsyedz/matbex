import { useCachedQuery } from "@/lib/redisCache";
import { dashboardQueryOptions } from "@/lib/query/queryPolicy";
import { qk } from "@/lib/query/queryKeys";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { format, subDays } from "date-fns";
import { formatZonedYMD, getRestaurantDayBoundsUTC } from "@/lib/timezone";
import { filterStaffActiveInPeriod, calculateMonthlyPayroll, isCurrentPeriod } from "@/lib/staffUtils";

export type ProfitStatus = "excellent" | "healthy" | "attention" | "critical";

export interface DailyProfitState {
  id: string;
  date: string;
  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  /** Net day-end adjustment posted for this date (signed). */
  dayEndAdjustment: number;
  /** netSales + dayEndAdjustment. Use for "actual cash collected" displays. */
  adjustedNetSales: number;
  foodCost: number;
  beverageCost: number;
  laborCost: number;
  otherExpenses: number;
  allocatedOverhead: number;
  primeCost: number;
  primeCostPercentage: number;
  operatingProfit: number;
  operatingMarginPercentage: number;
  status: ProfitStatus;
  isEstimated: boolean;
  performanceScore: number;
  // Expense breakdown by payment status
  paidExpenses: number;
  unpaidExpenses: number;
}

export interface ShiftContribution {
  id: string;
  shiftId: string;
  date: string;
  netSales: number;
  cashSales: number;
  cardSales: number;
  otherSales: number;
  estimatedFoodCost: number;
  estimatedLaborCost: number;
  shiftProfitEstimate: number;
  shiftMarginPercentage: number;
  shiftTime?: string;
  cashierName?: string;
}

export interface CategoryBreakdown {
  name: string;
  value: number;
  percentage: number;
  color: string;
}

export interface ExpenseByCategoryItem {
  categoryName: string;
  amount: number;
  percentage: number;
  color: string;
}

export interface DailyProfitData {
  today: DailyProfitState | null;
  yesterday: DailyProfitState | null;
  weekData: DailyProfitState[];
  shiftContributions: ShiftContribution[];
  revenueByCategory: CategoryBreakdown[];
  costBreakdown: CategoryBreakdown[];
  expensesByCategory: ExpenseByCategoryItem[];
  streaks: {
    healthyMarginDays: number;
    primeCostTargetDays: number;
  };
  isLoading: boolean;
}

// Fallback percentages when no real data available
const FALLBACK_FOOD_COST_PERCENTAGE = 0.28;
const FALLBACK_BEVERAGE_COST_PERCENTAGE = 0.05;
const FALLBACK_LABOR_COST_PERCENTAGE = 0.32;
const PRIME_COST_TARGET = 65;

function calculateStatus(primeCostPct: number, marginPct: number): ProfitStatus {
  if (primeCostPct <= 55 && marginPct >= 20) return "excellent";
  if (primeCostPct <= 65 && marginPct >= 10) return "healthy";
  if (primeCostPct <= 75 && marginPct >= 0) return "attention";
  return "critical";
}

function calculatePerformanceScore(
  primeCostPct: number,
  marginPct: number,
  variance: number
): number {
  let score = 50;
  
  // Prime cost contribution (max 30 points)
  if (primeCostPct <= 55) score += 30;
  else if (primeCostPct <= 60) score += 25;
  else if (primeCostPct <= 65) score += 20;
  else if (primeCostPct <= 70) score += 10;
  
  // Margin contribution (max 20 points)
  if (marginPct >= 20) score += 20;
  else if (marginPct >= 15) score += 15;
  else if (marginPct >= 10) score += 10;
  else if (marginPct >= 5) score += 5;
  
  // Variance penalty
  if (Math.abs(variance) > 50) score -= 10;
  else if (Math.abs(variance) > 20) score -= 5;
  
  return Math.max(0, Math.min(100, score));
}

export function useDailyProfit(selectedDate?: Date) {
  const { restaurant } = useAuth();
  const { activeBranchId, isBranchReady } = useBranch();
  const branchId = activeBranchId || null;
  /** Adds a branch filter when a specific branch is active. Untyped on purpose
   *  to avoid db-js query-builder type explosion. */
  const withBranch = (q: any, col = "branch_id"): any => (branchId ? q.eq(col, branchId) : q);
  const tz = restaurant?.timezone || "UTC";
  const today = selectedDate || new Date();
  const todayStr = formatZonedYMD(today, tz);
  const yesterdayStr = formatZonedYMD(subDays(today, 1), tz);
  const weekAgoStr = formatZonedYMD(subDays(today, 7), tz);

  // Fetch sales data for the day
  const { data: salesData, isLoading: salesLoading } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("sales", { restaurantId: restaurant?.id, branchId, extra: [todayStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { start, endExclusive } = getRestaurantDayBoundsUTC(today, tz);
      const { data, error } = await withBranch(
        db
          .from("sales_transactions")
          .select("total, payment_method, shift_id, created_at, branch_id, settlement_status")
          .eq("restaurant_id", restaurant.id)
          .gte("created_at", start.toISOString())
          .lt("created_at", endExclusive.toISOString())
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 60 * 1000, // Cache for 1 minute
  });

  // Fetch net day-end adjustments for the day (for adjusted-total displays)
  const { data: dayEndAdjustmentsData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("day-end-adjustments", { restaurantId: restaurant?.id, branchId, extra: [todayStr, yesterdayStr, weekAgoStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ business_date: string; amount: number }>;
      const { data, error } = await withBranch(
        db
          .from("day_end_adjustments")
          .select("business_date, amount, reversed_at, reversal_of_id")
          .eq("restaurant_id", restaurant.id)
          .gte("business_date", weekAgoStr)
          .lte("business_date", todayStr)
      );
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((a) => !a.reversed_at && !a.reversal_of_id)
        .map((a) => ({ business_date: a.business_date as string, amount: Number(a.amount || 0) }));
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 60 * 1000,
  });

  const sumAdjustmentsForDay = (dayStr: string) =>
    (dayEndAdjustmentsData ?? [])
      .filter((a) => a.business_date === dayStr)
      .reduce((sum, a) => sum + a.amount, 0);

  // Fetch reconciled daily_sales_summary rows for the visible window. When a
  // day has a closed summary, its `total_sales` is the "Adjusted Total" the
  // operator finalized and overrides raw POS for every downstream metric
  // (Net Sales, Prime Cost %, Operating Profit, Margin).
  const { data: dailySummariesData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("summaries", { restaurantId: restaurant?.id, branchId, extra: [weekAgoStr, todayStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ sales_date: string; total_sales: number; branch_id: string | null; status: string | null }>;
      // Day-end is branch-scoped: in a branch view only that branch's closed
      // days override raw POS totals. In "all branches" mode every branch's
      // closed summary must be summed, otherwise only one branch is counted.
      let q = db
        .from("daily_sales_summary")
        .select("sales_date, total_sales, branch_id, status")
        .eq("restaurant_id", restaurant.id)
        .gte("sales_date", weekAgoStr)
        .lte("sales_date", todayStr);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        sales_date: r.sales_date,
        total_sales: Number(r.total_sales || 0),
        branch_id: r.branch_id ?? null,
        status: r.status ?? null,
      }));
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 60 * 1000,
  });

  /** Raw POS totals per branch for the selected day (used to keep branches
   *  without a closed summary in the all-branches total). */
  const todayRawByBranch = (() => {
    const m = new Map<string, number>();
    ((salesData ?? []) as any[]).forEach((s) => {
      const k = String(s.branch_id ?? "none");
      m.set(k, (m.get(k) || 0) + Number(s.total || 0));
    });
    return m;
  })();

  const summaryForDay = (dayStr: string, rawByBranch?: Map<string, number>): number | null => {
    const rows = (dailySummariesData ?? []).filter(
      (s) => s.sales_date === dayStr && (s.status === "closed" || s.status === "approved" || s.status == null),
    );
    if (rows.length === 0) return null;
    let total = rows.reduce((sum, r) => sum + r.total_sales, 0);
    if (rawByBranch) {
      const covered = new Set(rows.map((r) => String(r.branch_id ?? "none")));
      rawByBranch.forEach((amount, key) => {
        if (!covered.has(key)) total += amount;
      });
    }
    return total;
  };


  // Fetch yesterday's sales for comparison
  const { data: yesterdaySalesData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("sales-yesterday", { restaurantId: restaurant?.id, branchId, extra: [yesterdayStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const yesterday = subDays(today, 1);
      const { start, endExclusive } = getRestaurantDayBoundsUTC(yesterday, tz);
      const { data, error } = await withBranch(
        db
          .from("sales_transactions")
          .select("total")
          .eq("restaurant_id", restaurant.id)
          .gte("created_at", start.toISOString())
          .lt("created_at", endExclusive.toISOString())
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  // Fetch week's sales for trend
  const { data: weekSalesData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("sales-week", { restaurantId: restaurant?.id, branchId, extra: [weekAgoStr, todayStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const weekAgo = subDays(today, 7);
      const { start } = getRestaurantDayBoundsUTC(weekAgo, tz);
      const { endExclusive } = getRestaurantDayBoundsUTC(today, tz);

      const { data, error } = await withBranch(
        db
          .from("sales_transactions")
          .select("total, created_at")
          .eq("restaurant_id", restaurant.id)
          .gte("created_at", start.toISOString())
          .lt("created_at", endExclusive.toISOString())
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  // Fetch expenses for the day
  const { data: expensesData, isLoading: expensesLoading } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("expenses", { restaurantId: restaurant?.id, branchId, extra: [todayStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await withBranch(
        db
          .from("expenses")
          .select("amount, status, expense_categories(name, color)")
          .eq("restaurant_id", restaurant.id)
          .is("deleted_at", null)
          .eq("expense_date", todayStr)
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 60 * 1000, // Cache for 1 minute
  });

  // Fetch shifts for the day
  const { data: shiftsData, isLoading: shiftsLoading } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("shifts", { restaurantId: restaurant?.id, branchId, extra: [todayStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { start, endExclusive } = getRestaurantDayBoundsUTC(today, tz);
      const { data: shifts, error } = await withBranch(
        db
          .from("shifts")
          .select("id, opened_at, closed_at, cashier_user_id")
          .eq("restaurant_id", restaurant.id)
          .gte("opened_at", start.toISOString())
          .lt("opened_at", endExclusive.toISOString())
      );
      if (error) throw error;

      const cashierIds = [
        ...new Set(((shifts || []) as any[]).map((s) => s.cashier_user_id).filter(Boolean)),
      ] as string[];

      let profileNameById = new Map<string, string>();
      if (cashierIds.length > 0) {
        const { data: profiles, error: profilesError } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", cashierIds);
        if (profilesError) throw profilesError;
        profileNameById = new Map(
          (profiles || []).map((p) => [p.id, p.full_name || "Unknown"])
        );
      }

      return ((shifts || []) as any[]).map((s) => ({
        ...s,
        // Keep the previous shape used below: shift.profiles.full_name
        profiles: { full_name: (s.cashier_user_id ? profileNameById.get(s.cashier_user_id) : null) || "Unknown" },
      }));
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 60 * 1000, // Cache for 1 minute
  });

  // Fetch overhead allocations (fixed costs like rent, utilities)
  const { data: overheadData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("overhead", { restaurantId: restaurant?.id, branchId }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await withBranch(
        db
          .from("overhead_allocation")
          .select("monthly_amount")
          .eq("restaurant_id", restaurant.id)
          .eq("is_active", true)
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 5 * 60 * 1000, // Static data - cache for 5 minutes
  });

  // Fetch staff data for payroll calculation - versioned based on selected date
  const { data: staffData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("staff-payroll", { restaurantId: restaurant?.id, branchId, extra: [todayStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      
      // For current/future dates, only fetch active staff (optimization)
      // For historical dates, fetch all staff for versioned filtering
      const isViewingCurrentDate = isCurrentPeriod(today);
      
      let query = db
        .from("staff")
        .select("monthly_salary, hourly_rate, joined_date, termination_date, is_active")
        .eq("restaurant_id", restaurant.id);

      if (branchId) query = query.eq("assigned_branch_id", branchId);

      if (isViewingCurrentDate) {
        query = query.eq("is_active", true);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      // Apply versioned filtering for historical dates
      if (!isViewingCurrentDate) {
        return filterStaffActiveInPeriod(data || [], today, today);
      }
      
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 3 * 60 * 1000, // Cache for 3 minutes
  });

  // Fetch inventory items for cost calculation
  const { data: inventoryData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("inventory", { restaurantId: restaurant?.id, branchId }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await withBranch(
        db
          .from("inventory_items")
          .select("current_stock, unit_cost")
          .eq("restaurant_id", restaurant.id)
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 5 * 60 * 1000, // Static data - cache for 5 minutes
  });

  // Fetch actual inventory usage for the day
  const { data: inventoryUsageData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("inventory-usage", { restaurantId: restaurant?.id, branchId, extra: [todayStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("inventory_usage")
        .select("total_cost, inventory_items(name)")
        .eq("restaurant_id", restaurant.id)
        .eq("usage_date", todayStr);
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 60 * 1000, // Cache for 1 minute
  });

  // Fetch sales items for recipe-based cost calculation
  const { data: salesItemsData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("sales-items", { restaurantId: restaurant?.id, branchId, extra: [todayStr] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { start, endExclusive } = getRestaurantDayBoundsUTC(today, tz);
      const { data, error } = await withBranch(
        db
          .from("sales_items")
          .select("menu_item_id, quantity")
          .eq("restaurant_id", restaurant.id)
          .gte("created_at", start.toISOString())
          .lt("created_at", endExclusive.toISOString())
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 60 * 1000, // Cache for 1 minute
  });

  // Fetch recipe ingredients for cost calculation
  const { data: recipeIngredientsData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("recipes", { restaurantId: restaurant?.id }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("recipe_ingredients")
        .select("menu_item_id, quantity_required, inventory_items(unit_cost)")
        .eq("restaurant_id", restaurant.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 5 * 60 * 1000, // Static data - cache for 5 minutes
  });

  // Fetch staff rates for labor cost calculation
  const { data: staffRatesData } = useCachedQuery({
    queryKey: qk.dailyProfit.entity("staff-rates", { restaurantId: restaurant?.id }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("staff_rates")
        .select("user_id, hourly_rate")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && isBranchReady,
    staleTime: 5 * 60 * 1000, // Static data - cache for 5 minutes
  });

  // Calculate recipe-based food cost from actual sales items
  const calculateRecipeBasedCost = () => {
    if (!salesItemsData || salesItemsData.length === 0 || !recipeIngredientsData) return null;
    
    let totalFoodCost = 0;
    
    for (const saleItem of salesItemsData) {
      const menuItemId = saleItem.menu_item_id;
      const quantity = saleItem.quantity || 1;
      
      // Find recipe ingredients for this menu item
      const ingredients = recipeIngredientsData.filter(r => r.menu_item_id === menuItemId);
      
      if (ingredients.length > 0) {
        // Calculate cost from recipe
        const itemCost = ingredients.reduce((sum, ing) => {
          const unitCost = ing.inventory_items?.unit_cost || 0;
          return sum + (Number(ing.quantity_required) * unitCost);
        }, 0);
        totalFoodCost += itemCost * quantity;
      }
    }
    
    return {
      totalCost: totalFoodCost,
      itemCount: salesItemsData.length,
      hasRealData: totalFoodCost > 0,
    };
  };

  // Calculate actual inventory usage cost for the day
  const calculateActualInventoryCost = () => {
    if (!inventoryUsageData || inventoryUsageData.length === 0) return null;
    
    const totalFoodCost = inventoryUsageData
      .reduce((sum, usage) => sum + Number(usage.total_cost || 0), 0);
    
    return {
      totalCost: totalFoodCost,
      itemCount: inventoryUsageData.length,
      hasRealData: true,
    };
  };

  // Calculate labor cost from shift hours and staff rates
  const calculateActualLaborCost = (shifts: typeof shiftsData) => {
    if (!shifts || shifts.length === 0 || !staffRatesData || staffRatesData.length === 0) {
      return null;
    }

    let totalLaborCost = 0;
    
    for (const shift of shifts) {
      if (!shift.opened_at) continue;
      
      // Calculate shift hours
      const openedAt = new Date(shift.opened_at);
      const closedAt = shift.closed_at ? new Date(shift.closed_at) : new Date();
      const hoursWorked = (closedAt.getTime() - openedAt.getTime()) / (1000 * 60 * 60);
      
      // Find staff rate for this cashier
      const staffRate = staffRatesData.find(r => r.user_id === shift.cashier_user_id);
      const hourlyRate = staffRate ? Number(staffRate.hourly_rate) : 0;
      
      totalLaborCost += hoursWorked * hourlyRate;
    }
    
    return {
      totalCost: totalLaborCost,
      hasRealData: staffRatesData.length > 0,
    };
  };

  // Calculate total inventory value for fallback estimation
  const calculateInventoryCost = () => {
    if (!inventoryData || inventoryData.length === 0) return null;
    
    const totalInventoryValue = inventoryData.reduce((sum, item) => {
      return sum + (Number(item.current_stock) * Number(item.unit_cost));
    }, 0);
    
    return {
      totalValue: totalInventoryValue,
      itemCount: inventoryData.length,
    };
  };

  // Food cost category names (expenses in these categories are food costs, not "other expenses")
  const FOOD_COST_CATEGORIES = [
    'Meat & Poultry',
    'Dairy',
    'Vegetables',
    'Ingredients / General Food Items',
  ];

  // Calculate daily profit state
  const calculateDailyProfit = (
    dayStr: string,
    dayDate: Date,
    sales: Array<{ total: number; [key: string]: any }> | null,
    expenses: typeof expensesData,
    overhead: typeof overheadData,
    staff: typeof staffData,
    dayEndAdjustment: number = 0,
    summaryOverride: number | null = null,
  ): DailyProfitState | null => {
    if (!sales) return null;

    const grossSales = sales.reduce((sum, s) => sum + Number(s.total), 0);
    const discounts = 0;
    const refunds = 0;
    const rawNetSales = grossSales - discounts - refunds;
    // Reconciled "final" net sales: if the operator closed the day with a
    // daily_sales_summary, that adjusted total wins. Otherwise apply the net
    // day-end adjustment on top of raw POS. Everything downstream
    // (prime-cost %, operating profit, margin) is computed against this.
    const netSales =
      summaryOverride != null ? summaryOverride : rawNetSales + dayEndAdjustment;

    // All expenses are included in prime cost (food cost component)
    const totalExpenses = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
    
    // Calculate paid vs unpaid expenses
    const paidExpenses = expenses?.filter(e => e.status === 'paid').reduce((sum, e) => sum + Number(e.amount), 0) || 0;
    const unpaidExpenses = expenses?.filter(e => e.status === 'unpaid').reduce((sum, e) => sum + Number(e.amount), 0) || 0;

    let foodCost: number;
    let beverageCost: number = 0;
    let isEstimated = false;

    if (totalExpenses > 0) {
      // Use actual recorded expenses as cost
      foodCost = totalExpenses;
      isEstimated = false;
    } else {
      // Fallback to recipe-based, inventory usage, or percentage estimation
      const recipeBasedCost = calculateRecipeBasedCost();
      const actualInventoryCost = calculateActualInventoryCost();
      const inventoryCost = calculateInventoryCost();

      if (recipeBasedCost && recipeBasedCost.hasRealData) {
        foodCost = recipeBasedCost.totalCost * 0.85;
        beverageCost = recipeBasedCost.totalCost * 0.15;
        isEstimated = false;
      } else if (actualInventoryCost && actualInventoryCost.hasRealData) {
        foodCost = actualInventoryCost.totalCost * 0.85;
        beverageCost = actualInventoryCost.totalCost * 0.15;
        isEstimated = false;
      } else if (inventoryCost && inventoryCost.itemCount > 0 && netSales > 0) {
        const expectedDailyUsage = inventoryCost.totalValue / 30;
        foodCost = expectedDailyUsage * 0.85;
        beverageCost = expectedDailyUsage * 0.15;
        isEstimated = true;
      } else {
        foodCost = netSales * FALLBACK_FOOD_COST_PERCENTAGE;
        beverageCost = netSales * FALLBACK_BEVERAGE_COST_PERCENTAGE;
        isEstimated = true;
      }
    }

    // Calculate labor cost from staff salaries (monthly ÷ operational days)
    // Per memory: payroll-daily-profit-calculation-method - labor should be included as daily overhead
    const laborCost = 0;
    // Labor cost is included in the prime cost calculation, not separately tracked
    // Setting to 0 as payroll is fetched separately in the overhead calculation

    // No separate "other expenses" - all expenses are part of prime cost
    const otherExpenses = 0;

    // Daily overhead allocation uses a fixed 30-day month (so partial months don't inflate per-day overhead)
    const allocationDays = 30;
    // Fixed overhead from overhead_allocation table (rent, utilities, etc.)
    const fixedOverhead =
      overhead?.reduce((sum, o) => {
        const monthlyAmount = Number(o.monthly_amount || 0);
        return sum + (allocationDays > 0 ? monthlyAmount / allocationDays : 0);
      }, 0) || 0;

    // Payroll overhead from staff salaries
    const payrollOverhead =
      staff?.reduce((sum, s) => {
        const salary = Number(s.monthly_salary) || 0;
        const hourlyEstimate = Number(s.hourly_rate) * 160 || 0;
        const monthlyAmount = salary > 0 ? salary : hourlyEstimate;
        return sum + (allocationDays > 0 ? monthlyAmount / allocationDays : 0);
      }, 0) || 0;

    // Total allocated overhead = fixed costs + payroll
    const allocatedOverhead = fixedOverhead + payrollOverhead;

    // Prime Cost = All daily expenses (just expenses, not overhead)
    // Per memory: "Prime cost includes ALL daily expenses (food, supplies, etc.)"
    const primeCost = totalExpenses + allocatedOverhead;
    const primeCostPercentage = netSales > 0 ? (primeCost / netSales) * 100 : 0;
    
    // Operating Profit = Net Sales - Prime Cost (which includes expenses + overhead)
    const operatingProfit = netSales - primeCost;
    const operatingMarginPercentage = netSales > 0 ? (operatingProfit / netSales) * 100 : 0;

    const status = calculateStatus(primeCostPercentage, operatingMarginPercentage);
    const performanceScore = calculatePerformanceScore(primeCostPercentage, operatingMarginPercentage, 0);

    return {
      id: `${dayStr}-${restaurant?.id}`,
      date: dayStr,
      grossSales,
      discounts,
      refunds,
      netSales,
      dayEndAdjustment,
      // Kept for API compatibility; same as netSales after reconciliation.
      adjustedNetSales: netSales,
      foodCost,
      beverageCost,
      laborCost,
      otherExpenses,
      allocatedOverhead,
      primeCost,
      primeCostPercentage,
      operatingProfit,
      operatingMarginPercentage,
      status,
      isEstimated,
      performanceScore,
      paidExpenses,
      unpaidExpenses,
    };
  };

  const todayProfit = calculateDailyProfit(
    todayStr,
    today,
    salesData || [],
    expensesData || [],
    overheadData || [],
    staffData || [],
    sumAdjustmentsForDay(todayStr),
    summaryForDay(todayStr, todayRawByBranch),
  );

  // Calculate yesterday's profit for comparison
  const yesterdayProfit = yesterdaySalesData
    ? calculateDailyProfit(
        yesterdayStr,
        subDays(today, 1),
        yesterdaySalesData,
        [],
        overheadData || [],
        staffData || [],
        sumAdjustmentsForDay(yesterdayStr),
        summaryForDay(yesterdayStr),
      )
    : null;

  // Calculate week data for trend
  const weekData: DailyProfitState[] = [];
  if (weekSalesData) {
    for (let i = 6; i >= 0; i--) {
      const day = subDays(today, i);
      const dayStr = formatZonedYMD(day, tz);
      const daySales = weekSalesData.filter((s) => formatZonedYMD(new Date(s.created_at), tz) === dayStr);
      const dayProfit = calculateDailyProfit(
        dayStr,
        day,
        daySales,
        [],
        overheadData || [],
        staffData || [],
        sumAdjustmentsForDay(dayStr),
        summaryForDay(dayStr),
      );
      if (dayProfit) {
        weekData.push(dayProfit);
      }
    }
  }

  // Calculate shift contributions
  const shiftContributions: ShiftContribution[] = (shiftsData || []).map((shift) => {
    const shiftSales = (salesData || []).filter((s) => s.shift_id === shift.id);
    const netSales = shiftSales.reduce((sum, s) => sum + Number(s.total), 0);
    // Tab sales (still unpaid) are not cash or card taken in the shift.
    const cashSales = shiftSales
      .filter((s) => s.payment_method === "cash" && s.settlement_status !== "unpaid")
      .reduce((sum, s) => sum + Number(s.total), 0);
    const cardSales = shiftSales
      .filter((s) => s.payment_method === "card" && s.settlement_status !== "unpaid")
      .reduce((sum, s) => sum + Number(s.total), 0);
    const otherSales = netSales - cashSales - cardSales;

    const estimatedFoodCost = netSales * FALLBACK_FOOD_COST_PERCENTAGE;
    const estimatedLaborCost = netSales * FALLBACK_LABOR_COST_PERCENTAGE;
    const shiftProfitEstimate = netSales - estimatedFoodCost - estimatedLaborCost;
    const shiftMarginPercentage = netSales > 0 ? (shiftProfitEstimate / netSales) * 100 : 0;

    const startTime = shift.opened_at ? format(new Date(shift.opened_at), "HH:mm") : "";
    const endTime = shift.closed_at ? format(new Date(shift.closed_at), "HH:mm") : "Active";

    return {
      id: shift.id,
      shiftId: shift.id,
      date: todayStr,
      netSales,
      cashSales,
      cardSales,
      otherSales,
      estimatedFoodCost,
      estimatedLaborCost,
      shiftProfitEstimate,
      shiftMarginPercentage,
      shiftTime: `${startTime} – ${endTime}`,
      cashierName: (shift as any).profiles?.full_name || "Unknown",
    };
  });

  // Revenue by payment method
  const revenueByCategory: CategoryBreakdown[] = [
    {
      name: "Cash",
      value: shiftContributions.reduce((sum, s) => sum + s.cashSales, 0),
      percentage: 0,
      color: "hsl(var(--chart-1))",
    },
    {
      name: "Card",
      value: shiftContributions.reduce((sum, s) => sum + s.cardSales, 0),
      percentage: 0,
      color: "hsl(var(--chart-2))",
    },
    {
      name: "Other",
      value: shiftContributions.reduce((sum, s) => sum + s.otherSales, 0),
      percentage: 0,
      color: "hsl(var(--chart-3))",
    },
  ];
  const totalRevenue = revenueByCategory.reduce((sum, c) => sum + c.value, 0);
  revenueByCategory.forEach((c) => {
    c.percentage = totalRevenue > 0 ? (c.value / totalRevenue) * 100 : 0;
  });

  // Cost breakdown for composition chart
  const costBreakdown: CategoryBreakdown[] = todayProfit
    ? [
        { name: "Food Cost", value: todayProfit.foodCost, percentage: 0, color: "hsl(var(--chart-5))" },
        { name: "Beverage Cost", value: todayProfit.beverageCost, percentage: 0, color: "hsl(var(--chart-4))" },
        { name: "Labor Cost", value: todayProfit.laborCost, percentage: 0, color: "hsl(var(--chart-3))" },
        { name: "Other Expenses", value: todayProfit.otherExpenses, percentage: 0, color: "hsl(var(--chart-2))" },
        { name: "Overhead", value: todayProfit.allocatedOverhead, percentage: 0, color: "hsl(var(--muted))" },
        { name: "Profit", value: Math.max(0, todayProfit.operatingProfit), percentage: 0, color: "hsl(var(--success))" },
      ]
    : [];
  const totalCostBreakdown = costBreakdown.reduce((sum, c) => sum + c.value, 0);
  costBreakdown.forEach((c) => {
    c.percentage = totalCostBreakdown > 0 ? (c.value / totalCostBreakdown) * 100 : 0;
  });

  // Group expenses by category
  const expensesByCategoryMap = new Map<string, number>();
  const categoryColors: Record<string, string> = {};
  const chartColors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
    "hsl(var(--primary))",
    "hsl(var(--secondary))",
  ];
  
  expensesData?.forEach((expense, index) => {
    const categoryName = expense.expense_categories?.name || "Uncategorized";
    const currentAmount = expensesByCategoryMap.get(categoryName) || 0;
    expensesByCategoryMap.set(categoryName, currentAmount + Number(expense.amount));
    if (!categoryColors[categoryName]) {
      categoryColors[categoryName] = expense.expense_categories?.color || chartColors[index % chartColors.length];
    }
  });

  const totalExpensesAmount = Array.from(expensesByCategoryMap.values()).reduce((sum, val) => sum + val, 0);
  const expensesByCategory: ExpenseByCategoryItem[] = Array.from(expensesByCategoryMap.entries()).map(([categoryName, amount]) => ({
    categoryName,
    amount,
    percentage: totalExpensesAmount > 0 ? (amount / totalExpensesAmount) * 100 : 0,
    color: categoryColors[categoryName] || "hsl(var(--muted))",
  }));

  // Calculate streaks (simplified - would need historical data)
  // Only count days with actual sales activity, otherwise a brand-new branch
  // with zero sales would trivially satisfy "under prime cost target" every day.
  const healthyDays = weekData.filter(
    (d) => d.netSales > 0 && (d.status === "excellent" || d.status === "healthy")
  ).length;
  const primeCostDays = weekData.filter(
    (d) => d.netSales > 0 && d.primeCostPercentage <= PRIME_COST_TARGET
  ).length;

  return {
    today: todayProfit,
    yesterday: yesterdayProfit,
    weekData,
    shiftContributions,
    revenueByCategory: revenueByCategory.filter((c) => c.value > 0),
    costBreakdown: costBreakdown.filter((c) => c.value > 0),
    expensesByCategory,
    streaks: {
      healthyMarginDays: healthyDays,
      primeCostTargetDays: primeCostDays,
    },
    isLoading: salesLoading || expensesLoading || shiftsLoading,
  };
}
