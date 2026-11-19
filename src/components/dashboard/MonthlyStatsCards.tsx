import { useState } from "react";
import { dashboardQueryOptions } from "@/lib/query/queryPolicy";
import { qk } from "@/lib/query/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useFiscalSettings, getFiscalMonthRange, getFiscalMonthProgress, getPreviousFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { useOverheadData } from "@/hooks/useOverheadData";
import { DatePreset } from "@/components/dashboard/DashboardFilters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Receipt, TrendingUp, ArrowUpRight, ArrowDownRight, Users, Target, ChevronDown, ChevronUp, CheckCircle, Clock, FileText, Sun, Moon } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { format, eachDayOfInterval } from "date-fns";
import { getAnalysisWindow } from "@/lib/analysisCutoff";
import { getEffectiveStartDate } from "@/lib/constants";
import { fetchReconciledSalesByDay } from "@/lib/reconciledSales";
import { OverheadFormulaBreakdown } from "@/components/dashboard/OverheadFormulaBreakdown";
import { useTranslation } from "react-i18next";

interface MonthlyStatsCardsProps {
  dateRange?: { from: Date; to: Date };
  preset?: DatePreset;
}

export function MonthlyStatsCards({ dateRange, preset }: MonthlyStatsCardsProps) {
  const { t } = useTranslation();
  const [overheadExpanded, setOverheadExpanded] = useState(false);
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const { monthStartDay, isLoading: fiscalLoading } = useFiscalSettings();

  const now = new Date();
  const useLastMonth = preset === "last_month";
  
  // Get the appropriate fiscal month range based on filter
  const currentFiscalRange = getFiscalMonthRange(now, monthStartDay);
  const prevFiscalRange = getPreviousFiscalMonthRange(now, monthStartDay);
  
  const { start: fiscalStart, end: fiscalEnd } = useLastMonth ? prevFiscalRange : currentFiscalRange;
  const { start: comparisonStart, end: comparisonEnd } = useLastMonth 
    ? getPreviousFiscalMonthRange(prevFiscalRange.start, monthStartDay) 
    : prevFiscalRange;
  
  const fiscalProgress = getFiscalMonthProgress(useLastMonth ? prevFiscalRange.start : now, monthStartDay);
  const { daysElapsed, daysRemaining, totalDays, yesterday } = useLastMonth 
    ? { 
        daysElapsed: Math.ceil((prevFiscalRange.end.getTime() - prevFiscalRange.start.getTime()) / (1000 * 60 * 60 * 24)) + 1, 
        daysRemaining: 0, 
        totalDays: Math.ceil((prevFiscalRange.end.getTime() - prevFiscalRange.start.getTime()) / (1000 * 60 * 60 * 24)) + 1,
        yesterday: prevFiscalRange.end
      }
    : fiscalProgress;
  
  const effectiveFiscalStart = getEffectiveStartDate(fiscalStart);
  const effectiveComparisonStart = getEffectiveStartDate(comparisonStart);
  
  // Use the full fiscal month end date for data queries (matches Sales page filter)
  // This ensures Monthly Sales card shows same totals as Sales page "Filtered Total"
  const dataCutoffDate = fiscalEnd;
  // Shared analysis window (cutoff = yesterday, last complete day) so every
  // monthly/forecast card uses the same denominator.
  const analysisWindow = getAnalysisWindow({
    periodStart: effectiveFiscalStart,
    periodEnd: fiscalEnd,
    isClosedPeriod: useLastMonth,
    now,
  });
  const chartCutoffDate = analysisWindow.cutoffDate;
  const elapsedDays = analysisWindow.elapsedDays;
  const remainingDays = analysisWindow.remainingDays;

  // Use shared overhead data hook - cached and deduplicated across dashboard
  const { data: overheadData, isLoading: overheadLoading } = useOverheadData(useLastMonth);

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: qk.monthlyStats.entity("sales", { restaurantId: restaurant?.id, branchId: activeBranchId, extra: [monthStartDay, useLastMonth, format(fiscalEnd, "yyyy-MM-dd"), format(chartCutoffDate, "yyyy-MM-dd")] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return { total: 0, previousTotal: 0, dailyData: [], paidSales: 0, unpaidSales: 0, totalOutstanding: 0, outstandingCustomers: 0, morningSales: 0, nightSales: 0 };
      
      // Read only through the last closed day (yesterday for the current month)
      const cutoffISO = chartCutoffDate.toISOString();
      const chartCutoffStr = format(chartCutoffDate, "yyyy-MM-dd");
      
      // Get shift templates and shifts with their templates
      // Outstanding balances must come from branch-taggable sales, never the
      // tenant-wide customers.current_balance column.
      let outstandingQuery = db
        .from("sales_transactions")
        .select("customer_id, total")
        .eq("restaurant_id", restaurant.id)
        .eq("settlement_status", "unpaid")
        .not("customer_id", "is", null);
      if (activeBranchId) outstandingQuery = outstandingQuery.eq("branch_id", activeBranchId);

      let branchSalesQuery = db.from("sales_transactions").select("total, created_at, settlement_status, shift_id")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", effectiveFiscalStart.toISOString())
        .lte("created_at", cutoffISO);
      if (activeBranchId) branchSalesQuery = branchSalesQuery.eq("branch_id", activeBranchId);

      const [templatesRes, shiftsRes, salesRes, outstandingRes, reconciledCurrent, reconciledPrev] = await Promise.all([
        db.from("shift_templates").select("id, name").eq("restaurant_id", restaurant.id),
        db.from("shifts").select("id, template_id").eq("restaurant_id", restaurant.id),
        branchSalesQuery,
        outstandingQuery,
        fetchReconciledSalesByDay({
          branchId: activeBranchId ?? null,
          restaurantId: restaurant.id,
          dateFrom: format(effectiveFiscalStart, "yyyy-MM-dd"),
          dateTo: chartCutoffStr,
        }),
        fetchReconciledSalesByDay({
          branchId: activeBranchId ?? null,
          restaurantId: restaurant.id,
          dateFrom: format(effectiveComparisonStart, "yyyy-MM-dd"),
          dateTo: format(comparisonEnd, "yyyy-MM-dd"),
        }),
      ]);
      
      // Build lookup maps
      const nightTemplateIds = new Set(
        templatesRes.data?.filter(t => 
          t.name.toLowerCase().includes('night') || t.name.toLowerCase().includes('evening')
        ).map(t => t.id) || []
      );
      
      const shiftTemplateMap = new Map<string, string>();
      shiftsRes.data?.forEach(s => shiftTemplateMap.set(s.id, s.template_id));
      
      // Calculate morning vs night sales from transactions
      let morningSales = 0;
      let nightSales = 0;
      const paidSales = salesRes.data?.filter(s => s.settlement_status !== "unpaid").reduce((sum, s) => sum + (s.total || 0), 0) || 0;
      const unpaidSales = salesRes.data?.filter(s => s.settlement_status === "unpaid").reduce((sum, s) => sum + (s.total || 0), 0) || 0;
      
      // Outstanding customer balances (branch-scoped when a branch is active)
      const outstandingByCustomer = new Map<string, number>();
      outstandingRes.data?.forEach((tx: { customer_id: string | null; total: number | null }) => {
        if (!tx.customer_id) return;
        outstandingByCustomer.set(
          tx.customer_id,
          (outstandingByCustomer.get(tx.customer_id) || 0) + Number(tx.total || 0),
        );
      });
      const totalOutstanding = Array.from(outstandingByCustomer.values()).reduce((s, v) => s + v, 0);
      const outstandingCustomers = Array.from(outstandingByCustomer.values()).filter((v) => v > 0).length;
      
      salesRes.data?.forEach(sale => {
        const templateId = shiftTemplateMap.get(sale.shift_id);
        if (templateId && nightTemplateIds.has(templateId)) {
          nightSales += sale.total || 0;
        } else {
          morningSales += sale.total || 0;
        }
      });

      // Reconciled totals (raw POS + active day-end adjustments, overridden by
      // daily_sales_summary). Single source of truth across the app.
      const total = reconciledCurrent.total;
      const previousTotal = reconciledPrev.total;

      // Build daily chart data from the reconciled per-day map
      const dailyMap = new Map<string, number>();
      for (const [dateKey, value] of reconciledCurrent.perDay) {
        const day = format(new Date(dateKey), "dd");
        dailyMap.set(day, (dailyMap.get(day) || 0) + value);
      }

      const daysInMonth = eachDayOfInterval({ start: effectiveFiscalStart, end: chartCutoffDate });
      const dailyData = daysInMonth.map((date) => ({ date: format(date, "dd"), value: dailyMap.get(format(date, "dd")) || 0 }));
      
      return { total, previousTotal, dailyData, paidSales, unpaidSales, totalOutstanding, outstandingCustomers, morningSales, nightSales };
    },
    enabled: !!restaurant?.id && !fiscalLoading,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  const { data: expensesData, isLoading: expensesLoading } = useQuery({
    queryKey: qk.monthlyStats.entity("expenses", { restaurantId: restaurant?.id, branchId: activeBranchId, extra: [monthStartDay, useLastMonth, format(fiscalEnd, "yyyy-MM-dd"), format(chartCutoffDate, "yyyy-MM-dd")] }),
    ...dashboardQueryOptions(),
    queryFn: async () => {
      if (!restaurant?.id) return { total: 0, previousTotal: 0, dailyData: [], paidExpenses: 0, unpaidExpenses: 0 };
      
      const chartCutoffStr = format(chartCutoffDate, "yyyy-MM-dd");
      
      let currentQuery = db.from("expenses").select("amount, expense_date, status").eq("restaurant_id", restaurant.id)
        .is("deleted_at", null).gte("expense_date", format(effectiveFiscalStart, "yyyy-MM-dd")).lte("expense_date", chartCutoffStr);
      let previousQuery = db.from("expenses").select("amount").eq("restaurant_id", restaurant.id)
        .is("deleted_at", null).gte("expense_date", format(effectiveComparisonStart, "yyyy-MM-dd")).lte("expense_date", format(comparisonEnd, "yyyy-MM-dd"));
      if (activeBranchId) {
        currentQuery = currentQuery.eq("branch_id", activeBranchId);
        previousQuery = previousQuery.eq("branch_id", activeBranchId);
      }

      const [currentMonth, previousMonth] = await Promise.all([currentQuery, previousQuery]);
      const total = currentMonth.data?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      const paidExpenses = currentMonth.data?.filter(e => e.status === 'paid').reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      const unpaidExpenses = currentMonth.data?.filter(e => e.status === 'unpaid').reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      const previousTotal = previousMonth.data?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      const dailyMap = new Map<string, number>();
      currentMonth.data?.forEach((expense) => {
        const day = format(new Date(expense.expense_date), "dd");
        dailyMap.set(day, (dailyMap.get(day) || 0) + (expense.amount || 0));
      });
      const daysInMonth = eachDayOfInterval({ start: effectiveFiscalStart, end: chartCutoffDate });
      const dailyData = daysInMonth.map((date) => ({ date: format(date, "dd"), value: dailyMap.get(format(date, "dd")) || 0 }));
      return { total, previousTotal, dailyData, paidExpenses, unpaidExpenses };
    },
    enabled: !!restaurant?.id && !fiscalLoading,
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  const isLoading = overheadLoading || salesLoading || expensesLoading || fiscalLoading;
  const totalOverhead = overheadData?.totalOverhead || 0;
  const salesChange = salesData?.previousTotal ? ((salesData.total - salesData.previousTotal) / salesData.previousTotal) * 100 : 0;
  const expensesChange = expensesData?.previousTotal ? ((expensesData.total - expensesData.previousTotal) / expensesData.previousTotal) * 100 : 0;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}><CardHeader className="pb-3"><Skeleton className="h-4 w-24" /></CardHeader>
            <CardContent><Skeleton className="h-8 w-32 mb-2" /><Skeleton className="h-20 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  const fiscalMonthLabel = `${format(fiscalStart, "MMM d")} - ${format(fiscalEnd, "MMM d")}`;
  const dailyAvgSales = (salesData?.total || 0) / elapsedDays;
  
  // Use ALL expenses (paid + unpaid) for accurate cost tracking
  const totalExpenses = expensesData?.total || 0;
  const dailyAvgExpenses = totalExpenses / elapsedDays;
  
  // For past months, show actual totals; for current month, show forecast.
  // NOTE: outstanding (unpaid) sales are ALREADY inside the reconciled sales
  // total — adding them again double-counted revenue in the forecast.
  const actualSales = salesData?.total || 0;
  const forecastedSales = useLastMonth ? actualSales : actualSales + dailyAvgSales * remainingDays;
  const forecastedExpenses = useLastMonth ? totalExpenses : totalExpenses + dailyAvgExpenses * remainingDays;
  const forecastedProfit = forecastedSales - forecastedExpenses - totalOverhead;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card><CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground flex items-center justify-between"><span className="flex items-center gap-2"><Building2 className="h-4 w-4" />{t("app.dashboard.monthly.overhead")}</span><span className="text-xs font-normal">{fiscalMonthLabel}</span></CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2"><span className="text-2xl font-bold text-foreground">{formatCurrency(totalOverhead)}</span></div>
          <p className="text-xs text-muted-foreground mt-1">{t("app.dashboard.monthly.fixedPayroll", { amount: formatCurrency(totalOverhead / totalDays) })}</p>
          <div className="mt-4 space-y-1">
            {/* Always show Payroll first when there's a totalPayable amount */}
            {(overheadData?.totalPayable ?? 0) > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" />{t("app.dashboard.monthly.payroll")}
                  {(overheadData?.paidStaffCount ?? 0) > 0 && (
                    <span className="text-[10px]">({t("app.dashboard.monthly.paidStaff", { paid: overheadData?.paidStaffCount, total: overheadData?.staffCount })})</span>
                  )}
                </span>
                <span className="font-medium">{formatCurrency(overheadData?.totalPayable ?? 0)}</span>
              </div>
            )}
            {/* Show fixed overhead items - only unpaid amounts */}
            {(overheadExpanded ? overheadData?.items : overheadData?.items?.slice(0, 2))?.filter(item => !item.is_paid).map((item) => (
              <div key={item.id} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{item.name}</span>
                <span className="font-medium">{formatCurrency(Number(item.remaining_amount ?? item.monthly_amount))}</span>
              </div>
            ))}
            {/* Show paid items with indicator */}
            {overheadExpanded && overheadData?.items?.filter(item => item.is_paid).map((item) => (
              <div key={item.id} className="flex justify-between text-xs opacity-60">
                <span className="text-muted-foreground flex items-center gap-1">
                  {item.name}
                  <span className="text-[10px] text-success">({t("app.dashboard.monthly.paid")})</span>
                </span>
                <span className="font-medium line-through">{formatCurrency(Number(item.monthly_amount))}</span>
              </div>
            ))}
            {(overheadData?.items?.length || 0) > 2 && (
              <button 
                onClick={() => setOverheadExpanded(!overheadExpanded)} 
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
              >
                {overheadExpanded ? (
                  <><ChevronUp className="h-3 w-3" />{t("app.dashboard.monthly.showLess")}</>
                ) : (
                  <>{t("app.dashboard.monthly.more", { count: (overheadData?.items.length || 0) - 2 })}<ChevronDown className="h-3 w-3" /></>
                )}
              </button>
            )}
          </div>
          <OverheadFormulaBreakdown
            fiscalStart={fiscalStart}
            fiscalEnd={fiscalEnd}
            totalDays={totalDays}
            cardTotal={totalOverhead}
          />
        </CardContent>
      </Card>

      <Card><CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground flex items-center justify-between"><span className="flex items-center gap-2"><TrendingUp className="h-4 w-4" />{t("app.dashboard.monthly.sales")}</span><span className="text-xs font-normal">{fiscalMonthLabel}</span></CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">{formatCurrency(salesData?.total || 0)}</span>
            {salesChange !== 0 && (<span className={`text-xs flex items-center ${salesChange > 0 ? "text-green-600" : "text-red-600"}`}>{salesChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(salesChange).toFixed(1)}%</span>)}
          </div>
          <div className="flex items-center gap-3 text-xs mt-1">
            <span className="flex items-center gap-1 text-warning" title={t("app.dashboard.monthly.morningShift")}>
              <Sun className="h-3 w-3" />
              {formatCurrency(salesData?.morningSales || 0)}
            </span>
            <span className="flex items-center gap-1 text-primary" title={t("app.dashboard.monthly.nightShift")}>
              <Moon className="h-3 w-3" />
              {formatCurrency(salesData?.nightSales || 0)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t("app.dashboard.monthly.progress", { elapsed: elapsedDays, remaining: useLastMonth ? 0 : remainingDays })}</p>
          
          {/* Total Outstanding Section */}
          {(salesData?.totalOutstanding || 0) > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                   {t("app.dashboard.monthly.outstanding")}
                </span>
                <span className="text-sm font-semibold text-amber-600">
                  {formatCurrency(salesData?.totalOutstanding || 0)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                 {t("app.dashboard.monthly.customers", { count: salesData?.outstandingCustomers || 0 })}
              </p>
            </div>
          )}
          
          <div className="h-16 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesData?.dailyData || []}>
                <defs><linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="date" hide /><YAxis hide />
                <Tooltip content={({ active, payload }) => active && payload?.length ? (<div className="bg-popover border rounded-md shadow-md px-2 py-1 text-xs"><p className="font-medium">{formatCurrency(payload[0].value as number)}</p></div>) : null} />
                <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#salesGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card><CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground flex items-center justify-between"><span className="flex items-center gap-2"><Receipt className="h-4 w-4" />{t("app.dashboard.monthly.expenses")}</span><span className="text-xs font-normal">{fiscalMonthLabel}</span></CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">{formatCurrency(expensesData?.total || 0)}</span>
            {expensesChange !== 0 && (<span className={`text-xs flex items-center ${expensesChange < 0 ? "text-green-600" : "text-red-600"}`}>{expensesChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(expensesChange).toFixed(1)}%</span>)}
          </div>
          <div className="flex items-center gap-3 text-xs mt-1">
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle className="h-3 w-3" />
              {formatCurrency(expensesData?.paidExpenses || 0)}
            </span>
            {(expensesData?.unpaidExpenses || 0) > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <Clock className="h-3 w-3" />
                {formatCurrency(expensesData?.unpaidExpenses || 0)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t("app.dashboard.monthly.progress", { elapsed: elapsedDays, remaining: useLastMonth ? 0 : remainingDays })}</p>
          <div className="h-16 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={expensesData?.dailyData || []}>
                <defs><linearGradient id="expensesGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} /><stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="date" hide /><YAxis hide />
                <Tooltip content={({ active, payload }) => active && payload?.length ? (<div className="bg-popover border rounded-md shadow-md px-2 py-1 text-xs"><p className="font-medium">{formatCurrency(payload[0].value as number)}</p></div>) : null} />
                <Area type="monotone" dataKey="value" stroke="hsl(var(--destructive))" strokeWidth={2} fill="url(#expensesGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card><CardHeader className="pb-3"><CardTitle className="text-base font-medium text-muted-foreground flex items-center justify-between"><span className="flex items-center gap-2"><Target className="h-4 w-4" />{useLastMonth ? t("app.dashboard.monthly.result") : t("app.dashboard.monthly.forecast")}</span><span className="text-xs font-normal">{fiscalMonthLabel}</span></CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${forecastedProfit >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(Math.abs(forecastedProfit))}</span>
            <span className={`text-xs ${forecastedProfit >= 0 ? 'text-success' : 'text-destructive'}`}>{forecastedProfit >= 0 ? t("app.dashboard.monthly.profit") : t("app.dashboard.monthly.loss")}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t("app.monthlyKpi.profitSubtitle")}</p>
          <div className="mt-4 space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">{useLastMonth ? t("app.dashboard.monthly.totalSales") : t("app.dashboard.monthly.forecastSales")}</span><span className="font-medium text-primary">{formatCurrency(forecastedSales)}</span></div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: useLastMonth ? "100%" : `${Math.min(((salesData?.total || 0) / forecastedSales) * 100, 100)}%` }} /></div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">{useLastMonth ? t("app.dashboard.monthly.totalExpenses") : t("app.dashboard.monthly.forecastExpenses")}</span><span className="font-medium text-destructive">{formatCurrency(forecastedExpenses)}</span></div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-destructive rounded-full transition-all duration-500" style={{ width: useLastMonth ? "100%" : `${Math.min(((expensesData?.total || 0) / forecastedExpenses) * 100, 100)}%` }} /></div>
            </div>
            <div className="pt-2 border-t"><div className="flex justify-between text-xs"><span className="text-muted-foreground">{t("app.dashboard.monthly.fixedOverhead")}</span><span className="font-medium">{formatCurrency(totalOverhead)}</span></div></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
