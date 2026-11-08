import { useState } from "react";
import { MilestoneCelebration } from "@/components/dashboard/MilestoneCelebration";
import { InventoryUsageTracker } from "@/components/inventory/InventoryUsageTracker";
import { ProfitSummaryReport } from "@/components/reports/ProfitSummaryReport";
import { ProfitAlerts } from "@/components/dashboard/ProfitAlerts";
import { SendProfitSummaryButton } from "@/components/dashboard/SendProfitSummaryButton";
import { DailyPLCard } from "@/components/reports/DailyPLCard";
import { DailyProfitLedgerPanel } from "@/components/reports/DailyProfitLedgerPanel";
import { AutoPostNetSalesButton } from "@/components/reports/AutoPostNetSalesButton";

import { PLPeriodComparison } from "@/components/reports/PLPeriodComparison";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { useDailyProfit, ProfitStatus } from "@/hooks/useDailyProfit";
import { useDailyPL, useWeeklyPL, useMonthlyPL } from "@/hooks/useProfitLoss";
import { useCurrency } from "@/hooks/useCurrency";
import { useBranch } from "@/contexts/BranchContext";
import { BranchScopeSelector } from "@/components/branches/BranchScopeSelector";
import { SupplierScopeSelector } from "@/components/filters/SupplierScopeSelector";
import { useAuth } from "@/contexts/AuthContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, subDays, addDays } from "date-fns";
import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  Clock,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  Flame,
  Target,
  Package,
  FileText,
  Building2,
  Lock as LockIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const statusConfig: Record<ProfitStatus, { labelKey: string; color: string; bg: string; border: string; icon: typeof CheckCircle }> = {
  excellent: { labelKey: "app.dailyProfit.status.excellent", color: "text-success", bg: "bg-success/10", border: "border-success/30", icon: Sparkles },
  healthy: { labelKey: "app.dailyProfit.status.healthy", color: "text-primary", bg: "bg-primary/10", border: "border-primary/30", icon: CheckCircle },
  attention: { labelKey: "app.dailyProfit.status.attention", color: "text-warning", bg: "bg-warning/10", border: "border-warning/30", icon: AlertTriangle },
  critical: { labelKey: "app.dailyProfit.status.critical", color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30", icon: AlertTriangle },
};

export default function DailyProfitPage() {
  const { t } = useTranslation();
  const chartConfig = {
    profit: { label: t("app.dailyProfit.kpi.profit"), color: "hsl(var(--success))" },
    netSales: { label: t("app.dailyProfit.kpi.netSales"), color: "hsl(var(--chart-1))" },
    primeCost: { label: t("app.dailyProfit.kpi.primeCost"), color: "hsl(var(--chart-5))" },
  };
  const [selectedDate, setSelectedDate] = useState(new Date());
  const {
    branches,
    hasMultipleBranches,
    canSwitchBranches,
    activeBranchId,
    pinnedBranchId,
  } = useBranch();
  const { hasRole } = useAuth();
  const canSeeAll = hasRole("owner") || hasRole("manager") || hasRole("accountant");
  const defaultBranch: string = pinnedBranchId ?? activeBranchId ?? (canSeeAll ? "all" : "");
  // Bound to BranchContext so every chart on this page (and the header
  // switcher) always resolve the same branch.
  const selectedBranch = defaultBranch;
  const effectiveBranch = pinnedBranchId ?? selectedBranch;
  const branchKey = effectiveBranch && effectiveBranch !== "all" ? effectiveBranch : null;
  const pinnedBranchName = branches.find((b) => b.id === pinnedBranchId)?.name;
  const { today, yesterday, weekData, shiftContributions, revenueByCategory, costBreakdown, expensesByCategory, streaks, isLoading } = useDailyProfit(selectedDate);
  const [supplierScope, setSupplierScope] = useState<string>("all");
  const supplierKey = supplierScope !== "all" ? supplierScope : null;
  const { current: dailyPL, previous: prevDailyPL, comparison: dailyComparison, isLoading: plLoading } = useDailyPL(selectedDate, branchKey, supplierKey);
  const { comparison: weeklyComparison } = useWeeklyPL(selectedDate, branchKey, supplierKey);
  const { format: formatCurrency, displayCurrency } = useCurrency();

  const goToPreviousDay = () => setSelectedDate((d) => subDays(d, 1));
  const goToNextDay = () => setSelectedDate((d) => addDays(d, 1));
  const isToday = format(selectedDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  const status = today ? statusConfig[today.status] : statusConfig.healthy;
  const StatusIcon = status.icon;

  // Prepare trend chart data
  const trendData = weekData.map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    profit: d.operatingProfit,
    netSales: d.netSales,
    primeCost: d.primeCostPercentage,
  }));

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header with Date Selector */}
        <header className="fade-slide-in">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
                  {t("app.dailyProfit.title")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("app.dailyProfit.subtitle")} • {displayCurrency}
                </p>
              </div>
            </div>
            
            {/* Date Navigator */}
            <div className="flex flex-wrap items-center gap-2">
              <SendProfitSummaryButton date={selectedDate} />

              <AutoPostNetSalesButton date={selectedDate} branchId={branchKey} />

              <BranchScopeSelector showLabel={false} hint="" />

              <SupplierScopeSelector value={supplierScope} onChange={setSupplierScope} className="w-[170px]" />

              <Button variant="outline" size="icon" onClick={goToPreviousDay}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[140px] sm:w-[180px] justify-start text-left font-normal text-sm">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(selectedDate, "MMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && setSelectedDate(date)}
                    disabled={(date) => date > new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              
              <Button variant="outline" size="icon" onClick={goToNextDay} disabled={isToday}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              
              {!isToday && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())}>
                  {t("app.dailyProfit.today")}
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* Status Banner */}
        {today && (
          <div
            className={cn(
              "flex items-center justify-between p-4 rounded-lg border fade-slide-in",
              status.bg,
              status.border,
              today.isEstimated && "border-dashed"
            )}
            style={{ animationDelay: "50ms" }}
          >
            <div className="flex items-center gap-3">
              <StatusIcon className={cn("h-5 w-5", status.color)} />
              <div>
                <span className={cn("font-medium", status.color)}>{t("app.dailyProfit.statusDay", { label: t(status.labelKey) })}</span>
                {today.isEstimated && (
                  <span className="ml-2 text-xs text-muted-foreground">({t("app.dailyProfit.estimated")})</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {streaks.healthyMarginDays > 0 && (
                <div className="flex items-center gap-1 text-success">
                  <Flame className="h-4 w-4" />
                  <span>{t("app.dailyProfit.streaks.healthy", { count: streaks.healthyMarginDays })}</span>
                </div>
              )}
              {streaks.primeCostTargetDays > 0 && (
                <div className="flex items-center gap-1 text-primary">
                  <Target className="h-4 w-4" />
                  <span>{t("app.dailyProfit.streaks.underTarget", { count: streaks.primeCostTargetDays })}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Profit Alerts */}
        <ProfitAlerts todayProfit={today} weekData={weekData} />

        {/* Ledger posting status for the day */}
        <DailyProfitLedgerPanel date={selectedDate} branchId={branchKey} />


        {/* KPI Summary Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 fade-slide-in" style={{ animationDelay: "100ms" }}>
          {isLoading ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="pt-6">
                    <Skeleton className="h-4 w-16 mb-2" />
                    <Skeleton className="h-6 w-24" />
                  </CardContent>
                </Card>
              ))}
            </>
          ) : today ? (
            <>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
                    <DollarSign className="h-3 w-3" />
                    {t("app.dailyProfit.kpi.netSales")}
                  </div>
                  <p className="text-xl font-semibold">{formatCurrency(today.netSales)}</p>
                  {today.dayEndAdjustment !== 0 && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                      {t("app.dailyProfit.kpi.adjusted", { value: formatCurrency(today.adjustedNetSales) })}{" "}
                      <span className="opacity-70">
                        ({today.dayEndAdjustment >= 0 ? "+" : "−"}
                        {formatCurrency(Math.abs(today.dayEndAdjustment))} {t("app.dailyProfit.kpi.dayEnd")})
                      </span>
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
                    <DollarSign className="h-3 w-3" />
                    {t("app.dailyProfit.kpi.primeCost")}
                  </div>
                  <p className={cn(
                    "text-xl font-semibold",
                    today.primeCostPercentage <= 65 ? "text-success" : "text-warning"
                  )}>
                    {formatCurrency(today.primeCost)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
                    <TrendingUp className="h-3 w-3" />
                    {t("app.dailyProfit.kpi.profit")}
                  </div>
                  <p className={cn(
                    "text-xl font-semibold",
                    today.operatingProfit >= 0 ? "text-success" : "text-destructive"
                  )}>
                    {formatCurrency(today.operatingProfit)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-1">
                    <Percent className="h-3 w-3" />
                    {t("app.dailyProfit.kpi.margin")}
                  </div>
                  <p className={cn(
                    "text-xl font-semibold",
                    today.operatingMarginPercentage >= 10 ? "text-success" : "text-warning"
                  )}>
                    {today.operatingMarginPercentage.toFixed(1)}%
                  </p>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="col-span-full">
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">{t("app.dailyProfit.kpi.noData")}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Main Content */}
        <Tabs defaultValue="composition" className="fade-slide-in" style={{ animationDelay: "150ms" }}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="pnl" className="gap-1">
              <FileText className="h-3 w-3" />
              {t("app.dailyProfit.tabs.pnl")}
            </TabsTrigger>
            <TabsTrigger value="composition">{t("app.dailyProfit.tabs.composition")}</TabsTrigger>
            <TabsTrigger value="shifts">{t("app.dailyProfit.tabs.shifts")}</TabsTrigger>
            <TabsTrigger value="inventory">{t("app.dailyProfit.tabs.inventory")}</TabsTrigger>
            <TabsTrigger value="trends">{t("app.dailyProfit.tabs.trends")}</TabsTrigger>
            <TabsTrigger value="reports">{t("app.dailyProfit.tabs.reports")}</TabsTrigger>
          </TabsList>

          {/* P&L Statement Tab */}
          <TabsContent value="pnl" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DailyPLCard 
                data={dailyPL} 
                previousData={prevDailyPL} 
                isLoading={plLoading} 
              />
              {weeklyComparison && (
                <PLPeriodComparison 
                  comparison={weeklyComparison} 
                  showDetailedBreakdown={false} 
                />
              )}
            </div>
            {dailyComparison && (
              <PLPeriodComparison comparison={dailyComparison} />
            )}
          </TabsContent>

          {/* Composition Tab */}
          <TabsContent value="composition" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Profit Composition Chart */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">{t("app.dailyProfit.cards.breakdown")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {costBreakdown.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
                      <PieChart>
                        <Pie
                          data={costBreakdown}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          label={({ name, percentage }) => `${name} ${percentage.toFixed(0)}%`}
                          labelLine={false}
                        >
                          {costBreakdown.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <ChartTooltip
                          content={({ payload }) => {
                            if (!payload?.length) return null;
                            const data = payload[0].payload;
                            return (
                              <div className="bg-popover border rounded-lg p-2 shadow-md">
                                <p className="font-medium">{data.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  {formatCurrency(data.value)} ({data.percentage.toFixed(1)}%)
                                </p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ChartContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      {t("app.dailyProfit.cards.noData")}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Revenue by Payment Method */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">{t("app.dailyProfit.cards.revenueByPayment")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {revenueByCategory.length > 0 ? (
                    <div className="space-y-4">
                      {revenueByCategory.map((cat) => (
                        <div key={cat.name} className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{cat.name}</span>
                            <span className="font-medium">{formatCurrency(cat.value)} ({cat.percentage.toFixed(0)}%)</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${cat.percentage}%`,
                                backgroundColor: cat.color,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                      {t("app.dailyProfit.cards.noSales")}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Cost Breakdown by Expense Category */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">{t("app.dailyProfit.cards.detailedCost")}</CardTitle>
              </CardHeader>
              <CardContent>
                {today ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {/* Expense categories */}
                    {expensesByCategory.map((category) => (
                      <div key={category.categoryName} className="p-4 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{category.categoryName}</p>
                        <p className="text-lg font-semibold">{formatCurrency(category.amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("app.dailyProfit.cards.ofSales", { value: ((category.amount / (today.netSales || 1)) * 100).toFixed(1) })}
                        </p>
                      </div>
                    ))}
                    
                    {/* Overhead */}
                    <div className="p-4 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t("app.dailyProfit.cards.overhead")}</p>
                      <p className="text-lg font-semibold">{formatCurrency(today.allocatedOverhead)}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("app.dailyProfit.cards.ofSales", { value: ((today.allocatedOverhead / (today.netSales || 1)) * 100).toFixed(1) })}
                      </p>
                    </div>
                    
                    {/* Operating Profit */}
                    <div className={cn(
                      "p-4 rounded-lg",
                      today.operatingProfit >= 0 ? "bg-success/10" : "bg-destructive/10"
                    )}>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t("app.dailyProfit.cards.operatingProfit")}</p>
                      <p className={cn(
                        "text-lg font-semibold",
                        today.operatingProfit >= 0 ? "text-success" : "text-destructive"
                      )}>
                        {formatCurrency(today.operatingProfit)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("app.dailyProfit.cards.marginSuffix", { value: today.operatingMarginPercentage.toFixed(1) })}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">{t("app.dailyProfit.kpi.noData")}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Shifts Tab */}
          <TabsContent value="shifts" className="space-y-6 mt-6">
            {today && today.dayEndAdjustment !== 0 && (
              <Card className="border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20">
                <CardContent className="pt-6 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      {t("app.dailyProfit.adjustment.title")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("app.dailyProfit.adjustment.subtitle")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold text-amber-800 dark:text-amber-200">
                      {today.dayEndAdjustment >= 0 ? "+" : "−"}
                      {formatCurrency(Math.abs(today.dayEndAdjustment))}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {t("app.dailyProfit.adjustment.total", { value: formatCurrency(today.adjustedNetSales) })}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {shiftContributions.length > 0 ? (
                shiftContributions.map((shift, index) => (
                  <Card
                    key={shift.id}
                    className="fade-slide-in card-lift"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="font-medium">{shift.shiftTime}</p>
                          <p className="text-sm text-muted-foreground">{shift.cashierName}</p>
                        </div>
                        <div className={cn(
                          "px-2 py-1 rounded-md text-xs font-medium",
                          shift.shiftMarginPercentage >= 40 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                        )}>
                          {t("app.dailyProfit.shift.marginSuffix", { value: shift.shiftMarginPercentage.toFixed(0) })}
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("app.dailyProfit.shift.netSales")}</span>
                          <span className="font-medium">{formatCurrency(shift.netSales)}</span>
                        </div>
                        <div className="h-px bg-border" />
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("app.dailyProfit.shift.cash")}</span>
                          <span>{formatCurrency(shift.cashSales)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("app.dailyProfit.shift.card")}</span>
                          <span>{formatCurrency(shift.cardSales)}</span>
                        </div>
                        {shift.otherSales > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t("app.dailyProfit.shift.other")}</span>
                            <span>{formatCurrency(shift.otherSales)}</span>
                          </div>
                        )}
                        <div className="h-px bg-border" />
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("app.dailyProfit.shift.foodCost")}</span>
                          <span>{formatCurrency(shift.estimatedFoodCost)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("app.dailyProfit.shift.laborCost")}</span>
                          <span>{formatCurrency(shift.estimatedLaborCost)}</span>
                        </div>
                        <div className="h-px bg-border" />
                        <div className="flex justify-between">
                          <span className="font-medium">{t("app.dailyProfit.shift.profit")}</span>
                          <span className={cn(
                            "font-medium",
                            shift.shiftProfitEstimate >= 0 ? "text-success" : "text-destructive"
                          )}>
                            {formatCurrency(shift.shiftProfitEstimate)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card className="col-span-full">
                  <CardContent className="pt-6 text-center">
                    <Clock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">{t("app.dailyProfit.cards.noShifts")}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="mt-6">
            <InventoryUsageTracker selectedDate={selectedDate} />
          </TabsContent>

          {/* Trends Tab */}
          <TabsContent value="trends" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Profit Trend */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">{t("app.dailyProfit.cards.profitTrend")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {trendData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" className="text-xs fill-muted-foreground" />
                        <YAxis className="text-xs fill-muted-foreground" />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line
                          type="monotone"
                          dataKey="profit"
                          name={t("app.dailyProfit.kpi.profit")}
                          stroke="hsl(var(--success))"
                          strokeWidth={2}
                          dot={{ fill: "hsl(var(--success))" }}
                        />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      {t("app.dailyProfit.cards.noTrend")}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Prime Cost Trend */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">{t("app.dailyProfit.cards.primeCostTrend")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {trendData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
                      <BarChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" className="text-xs fill-muted-foreground" />
                        <YAxis className="text-xs fill-muted-foreground" domain={[0, 100]} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar
                          dataKey="primeCost"
                          name={t("app.dailyProfit.kpi.primeCost")}
                          fill="hsl(var(--chart-1))"
                          radius={[4, 4, 0, 0]}
                        />
                        {/* Target line would be nice here */}
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      {t("app.dailyProfit.cards.noTrend")}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports" className="space-y-6 mt-6">
            <ProfitSummaryReport dailyData={weekData} period="weekly" />
          </TabsContent>
        </Tabs>

        {/* Performance Score */}
        {today && (
          <Card className="fade-slide-in" style={{ animationDelay: "200ms" }}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    {t("app.dailyProfit.score.title")}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    {t("app.dailyProfit.score.description")}
                  </p>
                </div>
                <div className="relative w-24 h-24">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="hsl(var(--muted))"
                      strokeWidth="2.5"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke={today.performanceScore >= 80 ? "hsl(var(--success))" : today.performanceScore >= 60 ? "hsl(var(--warning))" : "hsl(var(--destructive))"}
                      strokeWidth="2.5"
                      strokeDasharray={`${(today.performanceScore / 100) * 94.2} 94.2`}
                      strokeLinecap="round"
                      className="transition-all duration-1000"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-semibold">{today.performanceScore}</span>
                    <span className="text-xs text-muted-foreground">/100</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>


      {/* Milestone Celebration */}
      <MilestoneCelebration 
        streaks={streaks} 
        currentDayProfit={today?.operatingProfit || 0}
        weeklyProfitable={weekData.length >= 7 && weekData.every(d => d.operatingProfit > 0)}
      />
    </>
  );
}
