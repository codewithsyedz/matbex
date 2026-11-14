import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, subDays, addDays, isToday, isFuture } from "date-fns";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getRestaurantDayBoundsUTC, formatZonedYMD } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { PrimeCostRing, PrimeCostLegend } from "./PrimeCostRing";
import { filterStaffActiveInPeriod, calculateMonthlyPayroll, isCurrentPeriod } from "@/lib/staffUtils";

export function PrimeCostCard() {
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const { format: formatCurrency } = useCurrency();
  const { t } = useTranslation();
  const [selectedDate, setSelectedDate] = useState(subDays(new Date(), 1));

  const { data, isLoading } = useQuery({
    queryKey: ["daily-prime-cost", restaurant?.id, branchId, format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!restaurant?.id) return { foodCost: 0, laborCost: 0, primeCost: 0, netSales: 0 };

      const timezone = restaurant.timezone || "Asia/Riyadh";
      const dateStr = formatZonedYMD(selectedDate, timezone);
      const { start, endExclusive } = getRestaurantDayBoundsUTC(selectedDate, timezone);

      // daily_profit_state is tenant-wide, so only use it for the consolidated view
      const { data: profitData } = branchId
        ? { data: null }
        : await db
            .from("daily_profit_state")
            .select("food_cost, labor_cost, prime_cost, prime_cost_percentage, net_sales")
            .eq("restaurant_id", restaurant.id)
            .eq("date", dateStr)
            .maybeSingle();

      if (profitData) {
        const netSales = Number(profitData.net_sales) || 0;
        const foodCostAmount = Number(profitData.food_cost) || 0;
        const laborCostAmount = Number(profitData.labor_cost) || 0;
        
        const foodCostPct = netSales > 0 ? (foodCostAmount / netSales) * 100 : 0;
        const laborCostPct = netSales > 0 ? (laborCostAmount / netSales) * 100 : 0;
        
        return {
          foodCost: foodCostPct,
          laborCost: laborCostPct,
          primeCost: Number(profitData.prime_cost_percentage) || 0,
          netSales,
          foodCostAmount,
          laborCostAmount,
        };
      }

      // Calculate from raw data if no daily profit state
      let salesQuery = db
        .from("sales_transactions")
        .select("total")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", endExclusive.toISOString());
      if (branchId) salesQuery = salesQuery.eq("branch_id", branchId);
      const { data: salesData } = await salesQuery;

      const netSales = salesData?.reduce((sum, s) => sum + (Number(s.total) || 0), 0) || 0;

      // Get inventory usage for food cost
      const { data: usageData } = await db
        .from("inventory_usage")
        .select("total_cost")
        .eq("restaurant_id", restaurant.id)
        .eq("usage_date", dateStr);

      const foodCostAmount = usageData?.reduce((sum, u) => sum + (Number(u.total_cost) || 0), 0) || 0;

      // Get staff for labor cost estimation - versioned based on selected date
      const isViewingCurrentDate = isCurrentPeriod(selectedDate);
      
      let staffQuery = db
        .from("staff")
        .select("monthly_salary, hourly_rate, joined_date, termination_date, is_active")
        .eq("restaurant_id", restaurant.id);

      if (branchId) staffQuery = staffQuery.eq("assigned_branch_id", branchId);
      
      if (isViewingCurrentDate) {
        staffQuery = staffQuery.eq("is_active", true);
      }
      
      const { data: staffData } = await staffQuery;
      
      // Apply versioned filtering for historical dates
      const activeStaff = isViewingCurrentDate 
        ? staffData || []
        : filterStaffActiveInPeriod(staffData || [], selectedDate, selectedDate);

      const monthlyPayroll = calculateMonthlyPayroll(activeStaff);

      const laborCostAmount = monthlyPayroll / 30;

      const foodCostPct = netSales > 0 ? (foodCostAmount / netSales) * 100 : 0;
      const laborCostPct = netSales > 0 ? (laborCostAmount / netSales) * 100 : 0;
      const primeCost = foodCostPct + laborCostPct;

      return {
        foodCost: foodCostPct,
        laborCost: laborCostPct,
        primeCost,
        netSales,
        foodCostAmount,
        laborCostAmount,
      };
    },
    enabled: !!restaurant?.id,
  });

  const goToPreviousDay = () => {
    setSelectedDate(prev => subDays(prev, 1));
  };

  const goToNextDay = () => {
    const nextDay = addDays(selectedDate, 1);
    if (!isFuture(nextDay)) {
      setSelectedDate(nextDay);
    }
  };

  const target = 65;
  const isOverTarget = (data?.primeCost || 0) > target;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center">
            <Skeleton className="h-40 w-40 rounded-full" />
            <Skeleton className="h-4 w-48 mt-4" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="fade-slide-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            {t("app.dashboard.primeCost.title")}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={goToPreviousDay}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground min-w-[80px] text-center">
              {isToday(selectedDate) ? t("app.dashboard.primeCost.today") : format(selectedDate, "MMM dd")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={goToNextDay}
              disabled={isToday(selectedDate)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <PrimeCostRing 
          foodCost={data?.foodCost || 0} 
          laborCost={data?.laborCost || 0} 
          target={target} 
        />
        <PrimeCostLegend 
          foodCost={Math.round(data?.foodCost || 0)} 
          laborCost={Math.round(data?.laborCost || 0)} 
        />
        
        {/* Target indicator */}
        <div className="flex justify-center mt-3 pt-3 border-t">
          <span className={cn(
            "text-xs",
            isOverTarget ? "text-destructive" : "text-success"
          )}>
            {t(isOverTarget ? "app.dashboard.primeCost.targetOver" : "app.dashboard.primeCost.targetUnder", { target, diff: Math.abs((data?.primeCost || 0) - target).toFixed(1) })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
