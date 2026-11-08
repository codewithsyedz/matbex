import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { formatZonedYMD, getRestaurantDayBoundsUTC } from "@/lib/timezone";

export interface COGSData {
  date: string;
  openingStock: number;
  purchases: number;
  closingStock: number;
  cogs: number;
  cogsPercentage: number;
  netSales: number;
  grossProfit: number;
  grossMargin: number;
  variance: number;
  variancePercentage: number;
  theoreticalCOGS: number;
  isHealthy: boolean;
}

export interface IngredientCOGS {
  id: string;
  name: string;
  unit: string;
  openingStock: number;
  purchased: number;
  used: number;
  closingStock: number;
  unitCost: number;
  totalCost: number;
  percentage: number;
}

export interface COGSSummary {
  today: COGSData | null;
  yesterday: COGSData | null;
  weekData: COGSData[];
  monthlyAverage: {
    cogsPercentage: number;
    grossMargin: number;
    variancePercentage: number;
  };
  ingredientBreakdown: IngredientCOGS[];
  topCostItems: IngredientCOGS[];
  isLoading: boolean;
}

// Target benchmarks
const TARGET_COGS_MIN = 45;
const TARGET_COGS_MAX = 55;
const MAX_VARIANCE_PERCENTAGE = 5;

export function useCOGS(selectedDate?: Date) {
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const tz = restaurant?.timezone || "UTC";
  const today = selectedDate || new Date();
  const todayStr = formatZonedYMD(today, tz);
  const yesterdayStr = formatZonedYMD(subDays(today, 1), tz);
  const weekAgoStr = formatZonedYMD(subDays(today, 7), tz);
  const monthStart = format(startOfMonth(today), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(today), "yyyy-MM-dd");

  // Fetch inventory items with current stock
  const { data: inventoryItems, isLoading: inventoryLoading } = useQuery({
    queryKey: ["cogs-inventory", restaurant?.id, branchId],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("inventory_items")
        .select("*")
        .eq("restaurant_id", restaurant.id);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q.order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch purchases for the period
  const { data: purchasesData, isLoading: purchasesLoading } = useQuery({
    queryKey: ["cogs-purchases", restaurant?.id, branchId, monthStart, monthEnd],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("purchases")
        .select("*, inventory_items(name, unit)")
        .eq("restaurant_id", restaurant.id)
        .gte("received_at", `${monthStart}T00:00:00`)
        .lte("received_at", `${monthEnd}T23:59:59`);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch inventory usage for period
  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ["cogs-usage", restaurant?.id, branchId, monthStart, monthEnd],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      // inventory_usage has no branch column; scope through the branch's items.
      let branchItemIds: string[] | null = null;
      if (branchId) {
        const { data: bItems, error: bErr } = await supabase
          .from("inventory_items")
          .select("id")
          .eq("restaurant_id", restaurant.id)
          .eq("branch_id", branchId);
        if (bErr) throw bErr;
        branchItemIds = (bItems || []).map((i) => i.id);
        if (branchItemIds.length === 0) return [];
      }
      let q = supabase
        .from("inventory_usage")
        .select("*, inventory_items(name, unit)")
        .eq("restaurant_id", restaurant.id)
        .gte("usage_date", monthStart)
        .lte("usage_date", monthEnd);
      if (branchItemIds) q = q.in("inventory_item_id", branchItemIds);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch sales for COGS percentage calculation
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ["cogs-sales", restaurant?.id, branchId, monthStart, monthEnd],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { start } = getRestaurantDayBoundsUTC(new Date(monthStart), tz);
      const { endExclusive } = getRestaurantDayBoundsUTC(new Date(monthEnd), tz);
      let q = supabase
        .from("sales_transactions")
        .select("total, created_at")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", endExclusive.toISOString());
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch sales items for theoretical COGS (recipe-based)
  const { data: salesItemsData } = useQuery({
    queryKey: ["cogs-sales-items", restaurant?.id, branchId, todayStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { start, endExclusive } = getRestaurantDayBoundsUTC(today, tz);
      let q = supabase
        .from("sales_items")
        .select("*, menu_items(id, name)")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", endExclusive.toISOString());
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch recipe ingredients for theoretical cost
  const { data: recipeData } = useQuery({
    queryKey: ["cogs-recipes", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("recipe_ingredients")
        .select("*, inventory_items(unit_cost, name)")
        .eq("restaurant_id", restaurant.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Calculate COGS for a specific date
  const calculateDailyCOGS = (dateStr: string, targetDate: Date): COGSData | null => {
    if (!inventoryItems || !purchasesData || !usageData || !salesData) return null;

    // Calculate usage for this specific date
    const dayUsage = usageData.filter(u => u.usage_date === dateStr);
    const dayPurchases = purchasesData.filter(p => {
      const purchaseDate = format(new Date(p.received_at), "yyyy-MM-dd");
      return purchaseDate === dateStr;
    });

    // Get sales for the day
    const { start, endExclusive } = getRestaurantDayBoundsUTC(targetDate, tz);
    const daySales = salesData.filter(s => {
      const saleDate = new Date(s.created_at);
      return saleDate >= start && saleDate < endExclusive;
    });
    const netSales = daySales.reduce((sum, s) => sum + Number(s.total), 0);

    // Calculate opening stock (closing stock from previous day OR current stock minus today's changes)
    // For simplicity, we use current inventory value as base and adjust
    const totalInventoryValue = inventoryItems.reduce((sum, item) => 
      sum + (Number(item.current_stock) * Number(item.unit_cost)), 0);

    // Daily purchases value
    const purchasesValue = dayPurchases.reduce((sum, p) => sum + Number(p.total_cost), 0);

    // Daily usage/consumption value (actual COGS from usage tracking)
    const usageValue = dayUsage.reduce((sum, u) => sum + Number(u.total_cost), 0);

    // For automatic calculation:
    // Opening Stock = Current Stock + Usage - Purchases (reconstructed)
    // Since we track usage directly, COGS = Usage (actual consumption)
    const actualCOGS = usageValue;

    // Calculate theoretical COGS from recipes
    let theoreticalCOGS = 0;
    if (salesItemsData && recipeData && dateStr === todayStr) {
      for (const saleItem of salesItemsData) {
        const menuItemId = saleItem.menu_item_id;
        const quantity = saleItem.quantity || 1;
        const ingredients = recipeData.filter(r => r.menu_item_id === menuItemId);
        
        if (ingredients.length > 0) {
          const itemCost = ingredients.reduce((sum, ing) => {
            const unitCost = ing.inventory_items?.unit_cost || 0;
            return sum + (Number(ing.quantity_required) * unitCost);
          }, 0);
          theoreticalCOGS += itemCost * quantity;
        }
      }
    }

    // COGS formula: Opening Stock + Purchases - Closing Stock
    // With automatic tracking: COGS = actual usage recorded
    const openingStock = totalInventoryValue + usageValue - purchasesValue;
    const closingStock = totalInventoryValue;
    const cogs = actualCOGS > 0 ? actualCOGS : (openingStock + purchasesValue - closingStock);

    // Calculate percentages
    const cogsPercentage = netSales > 0 ? (cogs / netSales) * 100 : 0;
    const grossProfit = netSales - cogs;
    const grossMargin = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

    // Variance: Actual COGS vs Theoretical COGS
    const variance = theoreticalCOGS > 0 ? actualCOGS - theoreticalCOGS : 0;
    const variancePercentage = theoreticalCOGS > 0 ? (variance / theoreticalCOGS) * 100 : 0;

    const isHealthy = cogsPercentage >= TARGET_COGS_MIN && 
                      cogsPercentage <= TARGET_COGS_MAX && 
                      Math.abs(variancePercentage) <= MAX_VARIANCE_PERCENTAGE;

    return {
      date: dateStr,
      openingStock,
      purchases: purchasesValue,
      closingStock,
      cogs,
      cogsPercentage,
      netSales,
      grossProfit,
      grossMargin,
      variance,
      variancePercentage,
      theoreticalCOGS,
      isHealthy,
    };
  };

  // Calculate ingredient-level breakdown
  const calculateIngredientBreakdown = (): IngredientCOGS[] => {
    if (!inventoryItems || !purchasesData || !usageData) return [];

    const todayUsage = usageData.filter(u => u.usage_date === todayStr);
    const todayPurchases = purchasesData.filter(p => {
      const purchaseDate = format(new Date(p.received_at), "yyyy-MM-dd");
      return purchaseDate === todayStr;
    });

    const totalUsageCost = todayUsage.reduce((sum, u) => sum + Number(u.total_cost), 0);

    return inventoryItems.map(item => {
      const itemUsage = todayUsage.filter(u => u.inventory_item_id === item.id);
      const itemPurchases = todayPurchases.filter(p => p.inventory_item_id === item.id);

      const used = itemUsage.reduce((sum, u) => sum + Number(u.quantity_used), 0);
      const purchased = itemPurchases.reduce((sum, p) => sum + Number(p.quantity_received), 0);
      const totalCost = itemUsage.reduce((sum, u) => sum + Number(u.total_cost), 0);

      // Opening stock = current + used - purchased
      const openingStock = Number(item.current_stock) + used - purchased;

      return {
        id: item.id,
        name: item.name,
        unit: item.unit,
        openingStock,
        purchased,
        used,
        closingStock: Number(item.current_stock),
        unitCost: Number(item.unit_cost),
        totalCost,
        percentage: totalUsageCost > 0 ? (totalCost / totalUsageCost) * 100 : 0,
      };
    }).filter(item => item.used > 0 || item.purchased > 0)
      .sort((a, b) => b.totalCost - a.totalCost);
  };

  // Calculate week data
  const weekData: COGSData[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayDate = subDays(today, i);
    const dayStr = formatZonedYMD(dayDate, tz);
    const dayData = calculateDailyCOGS(dayStr, dayDate);
    if (dayData) weekData.push(dayData);
  }

  // Calculate monthly averages
  const validDays = weekData.filter(d => d.netSales > 0);
  const monthlyAverage = {
    cogsPercentage: validDays.length > 0 
      ? validDays.reduce((sum, d) => sum + d.cogsPercentage, 0) / validDays.length 
      : 0,
    grossMargin: validDays.length > 0 
      ? validDays.reduce((sum, d) => sum + d.grossMargin, 0) / validDays.length 
      : 0,
    variancePercentage: validDays.length > 0 
      ? validDays.reduce((sum, d) => sum + Math.abs(d.variancePercentage), 0) / validDays.length 
      : 0,
  };

  const ingredientBreakdown = calculateIngredientBreakdown();
  const topCostItems = ingredientBreakdown.slice(0, 5);

  return {
    today: calculateDailyCOGS(todayStr, today),
    yesterday: calculateDailyCOGS(yesterdayStr, subDays(today, 1)),
    weekData,
    monthlyAverage,
    ingredientBreakdown,
    topCostItems,
    isLoading: inventoryLoading || purchasesLoading || usageLoading || salesLoading,
  } as COGSSummary;
}
