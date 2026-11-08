import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions } from "@/lib/query/queryPolicy";
import { qk } from "@/lib/query/queryKeys";
import { useState } from "react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { fetchReconciledSalesByDay } from "@/lib/reconciledSales";
import { useCurrency } from "@/hooks/useCurrency";
import { useFiscalSettings, getFiscalMonthRange, getFiscalMonthProgress, getPreviousFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { useOverheadData } from "@/hooks/useOverheadData";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Building2, Receipt, TrendingUp, Target, Percent } from "lucide-react";
import { format } from "date-fns";
import { getAnalysisWindow } from "@/lib/analysisCutoff";
import { ar as arLocale } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/hooks/useLanguage";
import { getEffectiveStartDate } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { DatePreset } from "@/components/dashboard/DashboardFilters";

interface MonthlyKPICardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  variant?: "default" | "success" | "warning" | "destructive";
  delay?: number;
  percentage?: string;
}

function MonthlyKPICard({ title, value, subtitle, icon: Icon, variant = "default", delay = 0, percentage }: MonthlyKPICardProps) {
  const variantStyles = {
    default: "border-border bg-card",
    success: "border-success/20 bg-success/5",
    warning: "border-warning/20 bg-warning/5",
    destructive: "border-destructive/20 bg-destructive/5",
  };

  const iconStyles = {
    default: "bg-accent text-accent-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    destructive: "bg-destructive/10 text-destructive",
  };

  const percentageStyles = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };

  return (
    <div
      className={cn(
        "p-5 rounded-lg border card-lift fade-slide-in",
        variantStyles[variant]
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {title}
          </p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold tracking-tight text-foreground">
              {value}
            </p>
            {percentage && (
              <span className={cn("text-xs font-medium", percentageStyles[variant])}>
                {percentage}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <div className={cn("p-2 rounded-md", iconStyles[variant])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

interface MonthlyKPICardsProps {
  dateRange?: { from: Date; to: Date };
  preset?: DatePreset;
}

export function MonthlyKPICards({ dateRange, preset }: MonthlyKPICardsProps) {
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const [includeOverhead, setIncludeOverhead] = useState(true);
  const { format: formatCurrency } = useCurrency();
  const { monthStartDay, isLoading: fiscalLoading } = useFiscalSettings();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const dateLocale = language === "ar" ? arLocale : undefined;
  
  // Determine which fiscal month to show based on filter
  const now = new Date();
  const useLastMonth = preset === "last_month";
  
  // Get the appropriate fiscal month range
  const currentFiscalRange = getFiscalMonthRange(now, monthStartDay);
  const prevFiscalRange = getPreviousFiscalMonthRange(now, monthStartDay);
  
  const { start: fiscalStart, end: fiscalEnd } = useLastMonth ? prevFiscalRange : currentFiscalRange;
  const fiscalProgress = getFiscalMonthProgress(useLastMonth ? prevFiscalRange.start : now, monthStartDay);
  const { daysElapsed, daysRemaining, totalDays, yesterday } = useLastMonth 
    ? { daysElapsed: Math.ceil((prevFiscalRange.end.getTime() - prevFiscalRange.start.getTime()) / (1000 * 60 * 60 * 24)) + 1, daysRemaining: 0, totalDays: Math.ceil((prevFiscalRange.end.getTime() - prevFiscalRange.start.getTime()) / (1000 * 60 * 60 * 24)) + 1, yesterday: prevFiscalRange.end }
    : fiscalProgress;
  
  // Apply restaurant start date constraint
  const effectiveFiscalStart = getEffectiveStartDate(fiscalStart);
  
  // Shared analysis window: cutoff = yesterday (last complete day) for the
  // current month, period end for closed months.
  const analysisWindow = getAnalysisWindow({
    periodStart: effectiveFiscalStart,
    periodEnd: fiscalEnd,
    isClosedPeriod: useLastMonth,
    now,
  });
  const dataCutoffDate = analysisWindow.cutoffDate;

  // Use shared overhead data hook - cached and deduplicated
  const { data: overheadData, isLoading: overheadLoading } = useOverheadData(useLastMonth);

  // Fetch monthly sales using fiscal month (up to yesterday for current month)
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: qk.monthlyKpi.entity("sales", { restaurantId: restaurant?.id, branchId, extra: [monthStartDay, useLastMonth, format(dataCutoffDate, "yyyy-MM-dd")] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return { total: 0 };
      // Use the shared reconciliation helper so this card matches the rest of
      // the app (POS + active day-end adjustments, overridden by
      // daily_sales_summary). Also avoids the PostgREST 1000-row truncation
      // that silently undercounted busy months when reading sales_transactions
      // directly.
      const reconciled = await fetchReconciledSalesByDay({
        branchId,
        restaurantId: restaurant.id,
        dateFrom: format(effectiveFiscalStart, "yyyy-MM-dd"),
        dateTo: format(dataCutoffDate, "yyyy-MM-dd"),
      });
      return { total: reconciled.total };
    },
    enabled: !!restaurant?.id && !fiscalLoading,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  // Fetch ALL expenses (paid + unpaid) for cost calculation
  const { data: expensesData, isLoading: expensesLoading } = useQuery({
    queryKey: qk.monthlyKpi.entity("expenses", { restaurantId: restaurant?.id, branchId, extra: [monthStartDay, useLastMonth, format(dataCutoffDate, "yyyy-MM-dd")] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return { total: 0, paidTotal: 0, unpaidTotal: 0 };

      const cutoffDateStr = format(dataCutoffDate, "yyyy-MM-dd");
      
      let expensesQuery = db
        .from("expenses")
        .select("amount, status")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .gte("expense_date", format(effectiveFiscalStart, "yyyy-MM-dd"))
        .lte("expense_date", cutoffDateStr);
      if (branchId) expensesQuery = expensesQuery.eq("branch_id", branchId);

      const { data, error } = await expensesQuery;

      if (error) throw error;

      const total = data?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      const paidTotal = data?.filter(e => e.status === 'paid').reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      const unpaidTotal = data?.filter(e => e.status === 'unpaid').reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      
      return { total, paidTotal, unpaidTotal };
    },
    enabled: !!restaurant?.id && !fiscalLoading,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  const isLoading = overheadLoading || salesLoading || expensesLoading || fiscalLoading;

  // Operational days must match the window the data was read from
  // (effective fiscal start → data cutoff, inclusive), otherwise daily averages
  // and the forecast use the wrong denominator.
  const actualOperationalDays = analysisWindow.elapsedDays;
  const remainingDays = analysisWindow.remainingDays;

  // Full monthly overhead from shared hook
  const totalOverhead = overheadData?.totalOverhead || 0;
  
  const totalSales = salesData?.total || 0;
  const totalExpenses = expensesData?.total || 0;

  // Total costs respect the include-overhead filter
  const totalCosts = includeOverhead ? totalExpenses + totalOverhead : totalExpenses;
  
  // For past months, no forecast needed - show actual profit
  // For current month, calculate forecast projecting costs forward
  const dailyAvgSales = actualOperationalDays > 0 ? totalSales / actualOperationalDays : 0;
  const dailyAvgCosts = actualOperationalDays > 0 ? totalExpenses / actualOperationalDays : 0;
  const dailyAvgTotalCosts = actualOperationalDays > 0 ? totalCosts / actualOperationalDays : 0;
  
  const forecastedSales = useLastMonth ? totalSales : totalSales + dailyAvgSales * remainingDays;
  const forecastedExpensesProjected = useLastMonth
    ? totalExpenses
    : totalExpenses + dailyAvgCosts * remainingDays;
  const forecastedCosts = includeOverhead
    ? forecastedExpensesProjected + totalOverhead
    : forecastedExpensesProjected;
  const forecastedProfit = forecastedSales - forecastedCosts;
  const profitRatio = forecastedSales > 0 ? (forecastedProfit / forecastedSales) * 100 : 0;
  const profitRatioVariant = profitRatio >= 20 ? "success" : profitRatio >= 10 ? "warning" : "destructive";

  const fiscalMonthLabel = `${format(fiscalStart, "MMM d", { locale: dateLocale })} - ${format(fiscalEnd, "MMM d", { locale: dateLocale })}`;
  const currentMonth = format(fiscalStart, "MMMM", { locale: dateLocale });

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth lg:grid lg:grid-cols-3 xl:grid-cols-5 lg:overflow-visible lg:pb-0">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="data-panel p-5 min-w-[240px] flex-shrink-0 snap-start lg:min-w-0">
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2 px-1">
        <Label htmlFor="include-overhead-toggle" className="text-xs text-muted-foreground cursor-pointer">
           {includeOverhead ? t("app.monthlyKpi.includingOverhead") : t("app.monthlyKpi.expensesOnly")}
        </Label>
        <Switch
          id="include-overhead-toggle"
          checked={includeOverhead}
          onCheckedChange={setIncludeOverhead}
        />
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth -mx-1 px-1 lg:grid lg:grid-cols-3 xl:grid-cols-5 lg:overflow-visible lg:mx-0 lg:px-0 lg:pb-0">
      {includeOverhead && (
        <div className="min-w-[240px] flex-shrink-0 snap-start lg:min-w-0"><MonthlyKPICard
        title={t("app.monthlyKpi.overhead", { month: currentMonth })}
        value={formatCurrency(totalOverhead)}
        subtitle={t("app.monthlyKpi.overheadSubtitle", { range: fiscalMonthLabel })}
        icon={Building2}
        variant="default"
        delay={50}
      /></div>
      )}
      <div className="min-w-[240px] flex-shrink-0 snap-start lg:min-w-0"><MonthlyKPICard
        title={t("app.monthlyKpi.sales", { month: currentMonth })}
        value={formatCurrency(totalSales)}
        subtitle={t("app.monthlyKpi.salesSubtitle", { days: actualOperationalDays, avg: formatCurrency(dailyAvgSales) })}
        icon={TrendingUp}
        variant="success"
        delay={75}
      /></div>
      <div className="min-w-[240px] flex-shrink-0 snap-start lg:min-w-0"><MonthlyKPICard
        title={t("app.monthlyKpi.costs", { month: currentMonth })}
        value={formatCurrency(totalCosts)}
        subtitle={includeOverhead
          ? t("app.monthlyKpi.averagePerDay", { amount: formatCurrency(dailyAvgTotalCosts) })
          : t("app.monthlyKpi.averageExpensesOnly", { amount: formatCurrency(dailyAvgCosts) })}
        icon={Receipt}
        variant="warning"
        delay={100}
      /></div>
      <div className="min-w-[240px] flex-shrink-0 snap-start lg:min-w-0"><MonthlyKPICard
        title={useLastMonth
          ? t("app.monthlyKpi.result", { month: currentMonth })
          : t("app.monthlyKpi.forecast", { month: currentMonth })}
        value={formatCurrency(Math.abs(forecastedProfit))}
        subtitle={includeOverhead ? t("app.monthlyKpi.profitSubtitle") : t("app.monthlyKpi.excludesOverhead")}
        icon={Target}
        variant={forecastedProfit >= 0 ? "success" : "destructive"}
        delay={125}
        percentage={`${profitRatio >= 0 ? "+" : ""}${profitRatio.toFixed(1)}%`}
      /></div>
      <div className="min-w-[240px] flex-shrink-0 snap-start lg:min-w-0"><MonthlyKPICard
        title={t("app.monthlyKpi.profitRatio", { month: currentMonth })}
        value={`${profitRatio.toFixed(1)}%`}
        subtitle={useLastMonth ? t("app.monthlyKpi.actualMargin") : t("app.monthlyKpi.forecastMargin")}
        icon={Percent}
        variant={profitRatioVariant}
        delay={150}
      /></div>
      </div>
    </div>
  );
}
