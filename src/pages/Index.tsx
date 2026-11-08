import { useState, useEffect, lazy, Suspense } from "react";
import { Capacitor } from "@capacitor/core";
import { IdleMount } from "@/components/dashboard/IdleMount";
import { KPICard } from "@/components/dashboard/KPICard";
import { ShiftCard } from "@/components/dashboard/ShiftCard";
import { HealthBar } from "@/components/dashboard/HealthBar";
import { DashboardSection } from "@/components/dashboard/DashboardSection";
import { SalesDerivationBreakdown } from "@/components/dashboard/SalesDerivationBreakdown";
import { DeferUntilVisible } from "@/components/dashboard/DeferUntilVisible";
import {
  LazyDailyProfitCard,
  LazyMilestoneCelebration,
  LazyMonthlyStatsCards,
  LazyMonthlyKPICards,
  LazyDailyOverheadCard,
  LazyDailyExpensesCard,
  LazyDailySalesCard,
  LazyPrimeCostCard,
  LazyPendingSettlementsCard,
  LazyTopSellersCard,
  LazyOwnerDashboardAlerts,
  LazyDashboardQuotaAlerts,
  LazyOverheadDuplicateWarning,
} from "@/components/dashboard/lazySections";
import { LazyAllBranchesTotalsCard } from "@/components/dashboard/lazySections";
import { LazyMonthlyGroupTotalsCard } from "@/components/dashboard/lazySections";
import { DashboardFilters, DashboardFilterState, getDateRangeFromPreset, getComparisonDateRange } from "@/components/dashboard/DashboardFilters";
import { SkeletonCard, SkeletonShiftCard } from "@/components/ui/skeleton-card";
import { Button } from "@/components/ui/button";
import { SalesRecorder } from "@/components/pos/SalesRecorder";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useFiscalSettings } from "@/hooks/useFiscalSettings";

// Shift dialogs are only needed after a user interaction — keep them out of the
// initial dashboard chunk so first paint isn't blocked by parsing them.
const OpenShiftModal = lazy(() =>
  import("@/components/shifts/OpenShiftModal").then((m) => ({ default: m.OpenShiftModal })),
);
const CloseShiftModal = lazy(() =>
  import("@/components/shifts/CloseShiftModal").then((m) => ({ default: m.CloseShiftModal })),
);
const CashDropSheet = lazy(() =>
  import("@/components/shifts/CashDropSheet").then((m) => ({ default: m.CashDropSheet })),
);
const MilestoneSection = lazy(() =>
  import("@/components/dashboard/MilestoneSection").then((m) => ({ default: m.MilestoneSection })),
);
import { useAuth } from "@/contexts/AuthContext";
import { DemoFunnelCoach } from "@/components/demo/DemoFunnelCoach";
import { TrialCountdownCard } from "@/components/billing/TrialCountdownCard";
import { useDashboardFilterStore } from "@/stores/dashboardFilterStore";
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Users,
  Plus,
  ArrowRight,
  Banknote,
  Receipt,
  CreditCard,
  Wallet,
  ShoppingCart,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/hooks/useLanguage";
import { useBranch } from "@/contexts/BranchContext";
import { ProfilerBoundary } from "@/components/perf/ProfilerBoundary";

function DashboardInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { restaurant } = useAuth();
  const { monthStartDay } = useFiscalSettings();
  const { t, i18n } = useTranslation();
  const { isRTL } = useLanguage();
  const { activeBranch, isAllBranches, hasMultipleBranches } = useBranch();

  // Short, readable branch label used to suffix KPI titles ("Net Sales in Al-Wadi")
  const branchScopeLabel = !hasMultipleBranches
    ? null
    : isAllBranches
      ? t("app.dashboard.allBranches")
      : (activeBranch?.name ?? "").replace(/\s*branch\s*$/i, "").trim() || null;

  const scopedTitle = (title: string) =>
    branchScopeLabel
      ? isAllBranches
        ? t("app.dashboard.scopedTitleAll", { title, branch: branchScopeLabel })
        : t("app.dashboard.scopedTitleBranch", { title, branch: branchScopeLabel })
      : title;

  // Human-readable scope line shown at the bottom of each KPI info popover
  const kpiScopeLine = t("app.dashboard.scopeLine", {
    scope: branchScopeLabel
      ? isAllBranches
        ? t("app.dashboard.allBranchesCombined")
        : t("app.dashboard.branchOnly", { branch: branchScopeLabel })
      : t("app.dashboard.thisRestaurant"),
  });
  
  // Initialize filters with today
  const [filters, setFilters] = useState<DashboardFilterState>(() => {
    const defaultRange = getDateRangeFromPreset("today", 1); // Use default until fiscal settings load
    return {
      preset: "today",
      dateRange: defaultRange,
      comparison: "none",
    };
  });

  // Update date range when monthStartDay loads and fiscal-based presets are selected
  useEffect(() => {
    if (monthStartDay && (filters.preset === "this_month" || filters.preset === "last_month")) {
      const newDateRange = getDateRangeFromPreset(filters.preset, monthStartDay);
      setFilters(prev => ({ ...prev, dateRange: newDateRange }));
    }
  }, [monthStartDay, filters.preset]);

  // Calculate comparison range
  const comparisonRange = getComparisonDateRange(filters.dateRange, filters.comparison);

  // Mirror the active dashboard date range into a persisted store so that
  // background prefetchers can warm the exact same cache keys.
  const setStoredRange = useDashboardFilterStore((s) => s.setDateRange);
  useEffect(() => {
    if (!filters.dateRange?.from || !filters.dateRange?.to) return;
    setStoredRange({
      from: filters.dateRange.from.toISOString(),
      to: filters.dateRange.to.toISOString(),
      preset: filters.preset,
    });
  }, [
    filters.dateRange?.from?.getTime(),
    filters.dateRange?.to?.getTime(),
    filters.preset,
    setStoredRange,
  ]);

  // Deep-link support: when the URL hash points to a section (e.g. #section-sales
  // from the floating today-ticker badges), snap the dashboard filters to "today"
  // and scroll the matching card into view.
  useEffect(() => {
    const hash = location.hash?.replace("#", "");
    if (!hash) return;
    const valid = ["section-sales", "section-expenses"];
    if (!valid.includes(hash)) return;

    setFilters((prev) =>
      prev.preset === "today"
        ? prev
        : { ...prev, preset: "today", dateRange: getDateRangeFromPreset("today", monthStartDay || 1) },
    );

    const id = window.setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [location.hash, monthStartDay]);

  const { shifts, metrics, isLoading, loading, refetch } = useDashboardData({
    dateRange: filters.dateRange,
    comparisonRange,
  });
  // NOTE: useShiftsData / useDailyProfit were previously called here but their
  // results were unused (or only used by the milestone banner). Removing them
  // cuts ~20 queries from the dashboard's initial mount.

  const [openShiftModalOpen, setOpenShiftModalOpen] = useState(false);
  const [closeShiftModalOpen, setCloseShiftModalOpen] = useState(false);
  const [cashDropOpen, setCashDropOpen] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);

  const openShifts = shifts.filter((s) => s.status === "open");
  const myOpenShift = openShifts[0]; // First open shift for quick access

  const handleCloseShift = (shiftId: string) => {
    setSelectedShiftId(shiftId);
    setCloseShiftModalOpen(true);
  };

  const handleCashDrop = () => {
    if (myOpenShift) {
      setSelectedShiftId(myOpenShift.id);
      setCashDropOpen(true);
    }
  };

  const formatCurrency = (amount: number) => {
    const symbol = restaurant?.currency === "SAR" ? "﷼" : "$";
    return `${symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Calculate percentage changes for comparison
  const getPercentageChange = (current: number, previous: number | null): number | undefined => {
    if (previous === null || previous === 0) return undefined;
    return ((current - previous) / previous) * 100;
  };

  const avgSaleChange = getPercentageChange(metrics.averageSale, metrics.comparisonAvgSale);
  const avgExpenseChange = getPercentageChange(metrics.averageExpense, metrics.comparisonAvgExpense);
  const totalExpenseChange = getPercentageChange(metrics.totalExpenses, metrics.comparisonTotalExpenses);

  const today = new Date();
  const dateString = today.toLocaleDateString(isRTL ? "ar-SA" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const getComparisonLabel = () => {
    if (filters.comparison === "previous_period") return t("app.dashboard.comparison.previousPeriod");
    if (filters.comparison === "previous_year") return t("app.dashboard.comparison.previousYear");
    return "";
  };

  const getFilterPeriodLabel = () => {
    if (filters.preset === "custom") {
      return t("app.dashboard.presets.days", { count: metrics.daysInRange });
    }
    const key = `app.dashboard.presets.${filters.preset}`;
    const translated = t(key);
    return translated === key ? t("app.dashboard.presets.selected_period") : translated;
  };

  const getDailyAvgLabel = () => {
    if (filters.preset === "today" || filters.preset === "yesterday") {
      return getFilterPeriodLabel();
    }
    return t("app.dashboard.avgPerDay", { period: getFilterPeriodLabel() });
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <header className="space-y-4 fade-slide-in">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
                {t("app.dashboard.title")}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t("app.dashboard.subtitle", { date: dateString })}
              </p>
            </div>

            {/* Primary actions stay on the title baseline */}
            <div className="flex flex-wrap items-center gap-2">
              <SalesRecorder />
              {myOpenShift && (
                <Button variant="outline" size="sm" className="h-10" onClick={handleCashDrop}>
                  <Banknote className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">{t("app.dashboard.actions.cashDrop")}</span>
                </Button>
              )}
              <Button size="sm" className="h-10" onClick={() => setOpenShiftModalOpen(true)}>
                <Plus className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t("app.dashboard.actions.openShift")}</span>
              </Button>
            </div>
          </div>

          {/* Filter rail sits directly above the data it controls */}
          <div
            className="data-panel px-3 py-2.5 fade-slide-in"
            style={{ animationDelay: "15ms" }}
          >
            <DashboardFilters filters={filters} onFiltersChange={setFilters} />
          </div>
        </header>

        {/* Trial countdown */}
        <section className="fade-slide-in" style={{ animationDelay: "16ms" }}>
          <TrialCountdownCard />
        </section>

        {/* Quota Alerts */}
        <section className="fade-slide-in" style={{ animationDelay: "18ms" }}>
          <DashboardSection name="quota-alerts" fallback={null}>
            <LazyDashboardQuotaAlerts />
          </DashboardSection>
        </section>

        {/* Demo conversion funnel coach */}
        <section className="fade-slide-in" style={{ animationDelay: "18.5ms" }}>
          <DashboardSection name="overhead-duplicates" fallback={null}>
            <LazyOverheadDuplicateWarning />
          </DashboardSection>
        </section>

        {/* Demo conversion funnel coach */}
        <section className="fade-slide-in" style={{ animationDelay: "19ms" }}>
          <DemoFunnelCoach />
        </section>

        {/* KPI Threshold Alerts */}
        <section className="fade-slide-in" style={{ animationDelay: "20ms" }}>
          <DashboardSection name="owner-alerts" fallback={null}>
            <LazyOwnerDashboardAlerts />
          </DashboardSection>
        </section>

        {/* Daily Profit Hero Card */}
        <section className="fade-slide-in" style={{ animationDelay: "25ms" }}>
          <DashboardSection name="daily-profit">
            <LazyDailyProfitCard />
          </DashboardSection>
        </section>

        {/* ========== FILTERED PERIOD SECTION ========== */}
        <section className="space-y-4">
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.08em] fade-slide-in" style={{ animationDelay: "35ms" }}>
            {filters.preset === "custom" ? t("app.dashboard.sections.selectedPeriod") : getFilterPeriodLabel().charAt(0).toUpperCase() + getFilterPeriodLabel().slice(1)}
            {branchScopeLabel && <span className="ml-2 normal-case text-foreground/70">· {branchScopeLabel}</span>}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {loading.sales && loading.expenses ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : (
              <>
                <div className="fade-slide-in" style={{ animationDelay: "45ms" }}>
                  <KPICard
                    onRefresh={refetch}
                    isRefreshing={isLoading}
                    title={scopedTitle(t("app.dashboard.grossSalesVat"))}
                    value={formatCurrency(metrics.grossSales)}
                    change={metrics.netSalesChange}
                    changeLabel={filters.comparison !== "none" ? getComparisonLabel() : t("app.dashboard.txn", { count: metrics.totalTransactions })}
                    icon={DollarSign}
                    variant={metrics.netSalesChange > 0 ? "success" : metrics.netSalesChange < 0 ? "warning" : "default"}
                    infoScope={kpiScopeLine}
                    info={t("app.dashboard.grossSalesInfo")}
                    summary={
                      <div className="flex flex-col gap-1.5 text-xs">
                        <span className="text-muted-foreground break-words">
                          Net excl. VAT {formatCurrency(metrics.netExVatSales)} · VAT{" "}
                          {formatCurrency(metrics.vatAmount)}
                          {metrics.effectiveVatRate > 0
                            ? ` (${(metrics.effectiveVatRate * 100).toFixed(1)}% of gross)`
                            : ""}
                        </span>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1 whitespace-nowrap text-success">
                          <CheckCircle2 className="h-3 w-3" />
                          {formatCurrency(metrics.paidSales)}
                        </span>
                        {metrics.unpaidSales > 0 && (
                          <span className="flex items-center gap-1 whitespace-nowrap text-warning">
                            <Clock className="h-3 w-3" />
                            {formatCurrency(metrics.unpaidSales)}
                          </span>
                        )}
                        </div>
                        {Math.abs(metrics.reconciliationDelta) > 0.005 && (
                          <span className="text-muted-foreground break-words">
                            POS {formatCurrency(metrics.rawPosSales)} · reconciled{" "}
                            {metrics.reconciliationDelta > 0 ? "+" : ""}
                            {formatCurrency(metrics.reconciliationDelta)}
                          </span>
                        )}
                      </div>
                    }
                  />
                </div>
                <div className="fade-slide-in" style={{ animationDelay: "55ms" }}>
                  <KPICard
                    onRefresh={refetch}
                    isRefreshing={isLoading}
                    title={scopedTitle(t("app.dashboard.kpi.totalExpenses"))}
                    value={formatCurrency(metrics.totalExpenses)}
                    change={totalExpenseChange}
                    changeLabel={filters.comparison !== "none" ? getComparisonLabel() : t("app.dashboard.item", { count: metrics.totalExpenseCount })}
                    icon={Wallet}
                    variant={totalExpenseChange !== undefined && totalExpenseChange < 0 ? "success" : totalExpenseChange !== undefined && totalExpenseChange > 0 ? "warning" : "default"}
                    infoScope={kpiScopeLine}
                    info="All expense entries tagged to this branch for the selected period, including inventory purchases and operating costs. Paid (green) plus unpaid/accounts-payable (amber). Overheads and payroll are shown separately in the Fixed Cost breakdown."
                    summary={
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="flex items-center gap-1 whitespace-nowrap text-success">
                          <CheckCircle2 className="h-3 w-3" />
                          {formatCurrency(metrics.paidExpenses)}
                        </span>
                        <span className="flex items-center gap-1 whitespace-nowrap text-warning">
                          <Clock className="h-3 w-3" />
                          {formatCurrency(metrics.unpaidExpenses)}
                        </span>
                      </div>
                    }
                  />
                </div>
                <div className="fade-slide-in" style={{ animationDelay: "65ms" }}>
                  <KPICard
                    onRefresh={refetch}
                    isRefreshing={isLoading}
                    title={scopedTitle(t("app.dashboard.kpi.avgSale"))}
                    value={formatCurrency(metrics.dailyAvgSale)}
                    change={avgSaleChange}
                    changeLabel={filters.comparison !== "none" ? getComparisonLabel() : t("app.dashboard.perDay")}
                    icon={CreditCard}
                    variant={avgSaleChange !== undefined && avgSaleChange > 0 ? "success" : avgSaleChange !== undefined && avgSaleChange < 0 ? "warning" : "default"}
                    infoScope={kpiScopeLine}
                    info="Net sales for this branch divided by the number of days in the selected period — the branch's average daily revenue, not the average ticket size."
                  />
                </div>
                <div className="fade-slide-in" style={{ animationDelay: "75ms" }}>
                  <KPICard
                    onRefresh={refetch}
                    isRefreshing={isLoading}
                    title={scopedTitle(t("app.dashboard.kpi.avgExpense"))}
                    value={formatCurrency(metrics.dailyAvgExpense)}
                    change={avgExpenseChange}
                    changeLabel={filters.comparison !== "none" ? getComparisonLabel() : t("app.dashboard.perDay")}
                    icon={Receipt}
                    variant={avgExpenseChange !== undefined && avgExpenseChange < 0 ? "success" : avgExpenseChange !== undefined && avgExpenseChange > 0 ? "warning" : "default"}
                    infoScope={kpiScopeLine}
                    info="Total branch expenses divided by the number of days in the selected period — the average daily spend for this branch."
                  />
                </div>
                <div className="fade-slide-in" style={{ animationDelay: "85ms" }}>
                  <KPICard
                    onRefresh={refetch}
                    isRefreshing={isLoading}
                    title={scopedTitle(t("app.dashboard.kpi.cashSales"))}
                    value={formatCurrency(metrics.cashSales)}
                    changeLabel={t("app.dashboard.txn", { count: metrics.cashTransactions })}
                    icon={Banknote}
                    variant="default"
                    infoScope={kpiScopeLine}
                    info="Portion of this branch's sales settled in cash, taken from POS transactions and day-end summaries for the branch. Cash sales feed the expected drawer balance used in shift reconciliation."
                  />
                </div>
                <div className="fade-slide-in" style={{ animationDelay: "95ms" }}>
                  <KPICard
                    onRefresh={refetch}
                    isRefreshing={isLoading}
                    title={scopedTitle(t("app.dashboard.kpi.cardSales"))}
                    value={formatCurrency(metrics.cardSales)}
                    changeLabel={t("app.dashboard.txn", { count: metrics.cardTransactions })}
                    icon={CreditCard}
                    variant="default"
                    infoScope={kpiScopeLine}
                    info="Portion of this branch's sales settled by card or digital payment. Card sales are excluded from the cash drawer expectation and reconcile against the branch's card settlement reports."
                  />
                </div>
                <div className="fade-slide-in" style={{ animationDelay: "105ms" }}>
                  <KPICard
                    onRefresh={refetch}
                    isRefreshing={isLoading}
                    title={scopedTitle(t("app.dashboard.kpi.cashVariance"))}
                    value={formatCurrency(metrics.cashVariance)}
                    changeLabel={t("app.dashboard.kpi.totalVariance")}
                    icon={AlertTriangle}
                    variant={Math.abs(metrics.cashVariance) > 20 ? "warning" : "default"}
                    infoScope={kpiScopeLine}
                    info="Net cash variance for this branch: shift-close variances (counted minus expected cash) plus the day-end (11–11) close variance recorded in the daily sales summary. Positive means over, negative means short."
                    summary={
                      (metrics.shiftVariance !== 0 || metrics.dayEndVariance !== 0) ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="whitespace-nowrap">Shifts {formatCurrency(metrics.shiftVariance)}</span>
                          <span className="whitespace-nowrap">Day-end {formatCurrency(metrics.dayEndVariance)}</span>
                          {metrics.unresolvedVarianceDays > 0 && (
                            <span className="whitespace-nowrap text-warning">
                              {metrics.unresolvedVarianceDays} unresolved
                            </span>
                          )}
                        </div>
                      ) : undefined
                    }
                  />
                </div>
                <div className="fade-slide-in" style={{ animationDelay: "115ms" }}>
                  <KPICard
                    onRefresh={refetch}
                    isRefreshing={isLoading}
                    title={scopedTitle(t("app.dashboard.kpi.activeStaff"))}
                    value={metrics.activeStaff.toString()}
                    changeLabel={t("app.dashboard.kpi.currentlyActive")}
                    icon={Users}
                    infoScope={kpiScopeLine}
                    info="Count of staff whose assigned branch matches the selected branch and who have no termination date. Choosing All branches shows the tenant-wide headcount."
                  />
                </div>
              </>
            )}
          </div>
          {!(loading.sales && loading.expenses) && (
            <div className="fade-slide-in" style={{ animationDelay: "120ms" }}>
              <SalesDerivationBreakdown
                rawPosSales={metrics.rawPosSales}
                reconciliationDelta={metrics.reconciliationDelta}
                adjustmentsTotal={metrics.adjustmentsTotal}
                closedDaysCount={metrics.closedDaysCount}
                grossSales={metrics.grossSales}
                vatAmount={metrics.vatAmount}
                netExVatSales={metrics.netExVatSales}
                effectiveVatRate={metrics.effectiveVatRate}
                branchLabel={branchScopeLabel}
              />
            </div>
          )}
        </section>

        {/* ========== PERIOD STATS SECTION (responds to filter) ========== */}
        <section className="space-y-4">
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.08em] fade-slide-in" style={{ animationDelay: "125ms" }}>
            {filters.preset === "this_month" || filters.preset === "last_month" 
              ? (filters.preset === "this_month" ? t("app.dashboard.sections.currentMonth") : t("app.dashboard.sections.lastMonth"))
              : t("app.dashboard.sections.currentMonth")}
            {branchScopeLabel && <span className="ml-2 normal-case text-foreground/70">· {branchScopeLabel}</span>}
          </h2>
          <div className="fade-slide-in" style={{ animationDelay: "130ms" }}>
            <DeferUntilVisible minHeight={160}>
              <DashboardSection name="monthly-kpi">
                <LazyMonthlyKPICards dateRange={filters.dateRange} preset={filters.preset} />
              </DashboardSection>
            </DeferUntilVisible>
          </div>
          <div className="fade-slide-in" style={{ animationDelay: "140ms" }}>
            <DeferUntilVisible minHeight={220}>
              <DashboardSection name="monthly-stats">
                <LazyMonthlyStatsCards dateRange={filters.dateRange} preset={filters.preset} />
              </DashboardSection>
            </DeferUntilVisible>
          </div>
        </section>

        {/* ========== DAILY SECTION ========== */}
        <section className="space-y-6">
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.08em] fade-slide-in" style={{ animationDelay: "150ms" }}>
            {t("app.dashboard.sections.dailyOperations")}
          </h2>

          {/* Operations Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-12 gap-4 items-stretch">
            <div id="section-sales" className="fade-slide-in h-full min-w-0 scroll-mt-24 md:col-span-2 2xl:col-span-6 2xl:row-span-2" style={{ animationDelay: "160ms" }}>
              <DeferUntilVisible minHeight={180}>
                <DashboardSection name="daily-sales">
                  <LazyDailySalesCard />
                </DashboardSection>
              </DeferUntilVisible>
            </div>

            <div id="section-expenses" className="fade-slide-in h-full min-w-0 scroll-mt-24 2xl:col-span-3" style={{ animationDelay: "170ms" }}>
              <DeferUntilVisible minHeight={180}>
                <DashboardSection name="daily-expenses">
                  <LazyDailyExpensesCard />
                </DashboardSection>
              </DeferUntilVisible>
            </div>

            <div className="fade-slide-in h-full min-w-0 2xl:col-span-3" style={{ animationDelay: "180ms" }}>
              <DeferUntilVisible minHeight={180}>
                <DashboardSection name="daily-overhead">
                  <LazyDailyOverheadCard />
                </DashboardSection>
              </DeferUntilVisible>
            </div>

            <div className="fade-slide-in h-full min-w-0 md:col-span-2 2xl:col-span-6" style={{ animationDelay: "185ms" }}>
              <DeferUntilVisible minHeight={180}>
                <DashboardSection name="pending-settlements">
                  <LazyPendingSettlementsCard />
                </DashboardSection>
              </DeferUntilVisible>
            </div>

            <div className="md:col-span-2 2xl:col-span-12 grid grid-cols-1 2xl:grid-cols-2 gap-4 items-start 2xl:items-stretch min-w-0">
              {hasMultipleBranches && (
                <div className="fade-slide-in h-full" style={{ animationDelay: "186ms" }}>
                  <DeferUntilVisible minHeight={220}>
                    <DashboardSection name="all-branch-totals">
                      <LazyAllBranchesTotalsCard dateRange={filters.dateRange} />
                    </DashboardSection>
                  </DeferUntilVisible>
                </div>
              )}

              <div className="fade-slide-in h-full" style={{ animationDelay: "187ms" }}>
                <DeferUntilVisible minHeight={320}>
                  <DashboardSection name="monthly-group-totals">
                    <LazyMonthlyGroupTotalsCard />
                  </DashboardSection>
                </DeferUntilVisible>
              </div>
            </div>

            <div className="fade-slide-in h-full min-w-0 md:col-span-2 2xl:col-span-12" style={{ animationDelay: "188ms" }}>
              <DeferUntilVisible minHeight={240}>
                <DashboardSection name="top-sellers">
                  <LazyTopSellersCard dateRange={filters.dateRange} />
                </DashboardSection>
              </DeferUntilVisible>
            </div>
          </div>

          {/* Prime Cost & Health Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="fade-slide-in" style={{ animationDelay: "190ms" }}>
              <DeferUntilVisible minHeight={260}>
                <DashboardSection name="prime-cost">
                  <LazyPrimeCostCard />
                </DashboardSection>
              </DeferUntilVisible>
            </div>

            <div
              className="data-panel p-5 md:p-6 fade-slide-in"
              style={{ animationDelay: "200ms" }}
            >
              <h2 className="font-display text-base font-semibold tracking-tight mb-5">
                {t("app.dashboard.sections.dailyHealth")}
              </h2>
              <div className="grid grid-cols-1 gap-4">
                {isLoading ? (
                  <>
                    <div className="space-y-2">
                      <div className="h-4 w-24 rounded skeleton-shimmer" />
                      <div className="h-2 w-full rounded skeleton-shimmer" />
                    </div>
                    <div className="space-y-2">
                      <div className="h-4 w-24 rounded skeleton-shimmer" />
                      <div className="h-2 w-full rounded skeleton-shimmer" />
                    </div>
                    <div className="space-y-2">
                      <div className="h-4 w-24 rounded skeleton-shimmer" />
                      <div className="h-2 w-full rounded skeleton-shimmer" />
                    </div>
                  </>
                ) : (
                  <>
                    <HealthBar label={t("app.dashboard.health.cashDiscipline")} value={92} target={95} />
                    <HealthBar label={t("app.dashboard.health.closingOnTime")} value={88} target={90} />
                    <HealthBar label={t("app.dashboard.health.reportingComplete")} value={100} target={100} />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Streak Badge */}
          {!isLoading && shifts.filter((s) => s.varianceStatus === "perfect").length >= 3 && (
            <div
              className="flex items-center justify-center py-4 fade-slide-in"
              style={{ animationDelay: "210ms" }}
            >
              <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-success/10 border border-success/20">
                <span className="text-success text-sm font-medium">
                  {t("app.dashboard.shifts.perfectStreak", { count: shifts.filter((s) => s.varianceStatus === "perfect").length })}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* Recent Shifts (moved to bottom) */}
        <section className="space-y-4 fade-slide-in" style={{ animationDelay: "325ms" }}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold tracking-tight">
              {t("app.dashboard.sections.recentShifts")}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => navigate("/shifts")}
            >
              {t("app.dashboard.sections.viewAll")}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2">
            {isLoading ? (
              <>
                <SkeletonShiftCard />
                <SkeletonShiftCard />
                <SkeletonShiftCard />
              </>
            ) : shifts.length === 0 ? (
              <div className="flex-1 flex items-center justify-center h-40 rounded-lg border border-dashed border-border bg-muted/30">
                <div className="text-center">
                  <p className="text-muted-foreground">{t("app.dashboard.shifts.noShifts")}</p>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setOpenShiftModalOpen(true)}
                  >
                    {t("app.dashboard.shifts.openFirst")}
                  </Button>
                </div>
              </div>
            ) : (
              shifts.slice(0, 5).map((shift, index) => (
                <div
                  key={shift.id}
                  className="fade-slide-in"
                  style={{ animationDelay: `${index * 75}ms` }}
                >
                  <ShiftCard
                    id={shift.id}
                    cashier={shift.cashier}
                    startTime={shift.startTime}
                    endTime={shift.endTime}
                    status={shift.status}
                    expectedCash={shift.expectedCash}
                    countedCash={shift.countedCash}
                    variance={shift.variance}
                    varianceStatus={shift.varianceStatus}
                    drawer={shift.drawer}
                    onClose={
                      shift.status === "open"
                        ? () => handleCloseShift(shift.id)
                        : undefined
                    }
                    shiftMeta={shift.meta}
                  />
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Modals — mounted only once opened so their chunks load on demand */}
      {openShiftModalOpen && (
        <Suspense fallback={null}>
          <OpenShiftModal
            open={openShiftModalOpen}
            onOpenChange={setOpenShiftModalOpen}
            onShiftOpened={refetch}
          />
        </Suspense>
      )}

      {selectedShiftId && (closeShiftModalOpen || cashDropOpen) && (
        <Suspense fallback={null}>
          <CloseShiftModal
            open={closeShiftModalOpen}
            onOpenChange={setCloseShiftModalOpen}
            shift={shifts.find(s => s.id === selectedShiftId) ? {
              id: selectedShiftId,
              drawer_id: "",
              opening_float: shifts.find(s => s.id === selectedShiftId)?.expectedCash || 0,
              opened_at: "",
            } : null}
            onShiftClosed={refetch}
          />
          <CashDropSheet
            open={cashDropOpen}
            onOpenChange={setCashDropOpen}
            shiftId={selectedShiftId}
            onSuccess={refetch}
          />
        </Suspense>
      )}

      {/* Milestone Celebration */}
      <DashboardSection name="milestone" fallback={null}>
        <IdleMount timeout={4000} fallback={null}>
          <Suspense fallback={null}>
            <MilestoneSection />
          </Suspense>
        </IdleMount>
      </DashboardSection>
    </>
  );
}

function DashboardShellFallback() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <header className="space-y-2">
        <div className="h-6 w-32 rounded skeleton-shimmer" />
        <div className="h-3 w-48 rounded skeleton-shimmer" />
      </header>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg skeleton-shimmer" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-lg skeleton-shimmer" />
        <div className="h-64 rounded-lg skeleton-shimmer" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  // On Android APK and small viewports, defer the heavy dashboard subtree
  // until the browser is idle so the sidebar / menu paints instantly and
  // navigation never blocks on data hooks or lazy chunks.
  const isLowPowerSurface =
    Capacitor.isNativePlatform() ||
    (typeof window !== "undefined" && window.innerWidth < 1024);

  return (
    <>
      <IdleMount eager={!isLowPowerSurface} fallback={<DashboardShellFallback />}>
        <ProfilerBoundary id="Dashboard">
          <DashboardInner />
        </ProfilerBoundary>
      </IdleMount>
    </>
  );
}
