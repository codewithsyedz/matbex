import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFunnelTracker } from "@/hooks/useFunnelTracker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "recharts";
import { Download, TrendingUp, TrendingDown, DollarSign, Clock, FileSpreadsheet, FileText, CalendarClock, GitCompare, BarChart3, Receipt, PieChart as PieChartIcon, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useReconciledSales, reconcileDaySales } from "@/lib/reconciledSales";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval, differenceInDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/reports/DateRangePicker";
import { ReportScheduleDialog } from "@/components/reports/ReportScheduleDialog";
import { ReportSchedulesList } from "@/components/reports/ReportSchedulesList";
import { ComparisonChart } from "@/components/reports/ComparisonChart";
import { KPIComparison } from "@/components/reports/KPIComparison";
import { AdvancedReportMetrics } from "@/components/reports/AdvancedReportMetrics";
import { ProfitLossStatement } from "@/components/reports/ProfitLossStatement";
import { AutoPostExpensesButton } from "@/components/reports/AutoPostExpensesButton";
import { CostBreakdownChart } from "@/components/reports/CostBreakdownChart";
import { TopPerformersTable } from "@/components/reports/TopPerformersTable";
import { CategoryMarginReport } from "@/components/reports/CategoryMarginReport";
import { BranchComparisonReport } from "@/components/reports/BranchComparisonReport";
import { BranchShiftSummaryReport } from "@/components/reports/BranchShiftSummaryReport";
import { BranchScopeSelector } from "@/components/branches/BranchScopeSelector";
import { useCurrency } from "@/hooks/useCurrency";
import {
  exportToCSV,
  exportToPDF,
  prepareSalesExportData,
  prepareExpensesExportData,
  prepareShiftsExportData,
} from "@/lib/exportUtils";
import { toast } from "sonner";

const chartConfig = {
  sales: { label: "Sales", color: "hsl(var(--chart-1))" },
  expenses: { label: "Expenses", color: "hsl(var(--chart-5))" },
  cash: { label: "Cash", color: "hsl(var(--chart-3))" },
  card: { label: "Card", color: "hsl(var(--chart-2))" },
  other: { label: "Other", color: "hsl(var(--chart-4))" },
};

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export default function Reports() {
  const { restaurant, hasFeature } = useAuth();
  const { t } = useTranslation();
  const { hasMultipleBranches, activeBranchId, pinnedBranchId, branches } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const branchScopeLabel = branchId
    ? branches.find((b) => b.id === branchId)?.name ?? "Selected branch"
    : "All branches";
  const queryClient = useQueryClient();
  const { track: trackFunnel } = useFunnelTracker();

  useEffect(() => {
    trackFunnel("first_report_view");
  }, [trackFunnel]);
  
  // Feature checks
  const hasAdvancedReports = hasFeature("advanced_reports");
  const hasEmailReports = hasFeature("email_reports");
  const { format: formatCurrency, displayCurrency } = useCurrency();
  const [presetRange, setPresetRange] = useState("7");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(undefined);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  // Stabilize "today" to start of day to avoid query key changes during render
  const today = startOfDay(new Date());
  
  // Use custom date range if set, otherwise use preset
  const startDate = customDateRange?.from ? startOfDay(customDateRange.from) : subDays(today, parseInt(presetRange));
  const endDate = customDateRange?.to ? endOfDay(customDateRange.to) : endOfDay(today);
  
  // Format dates for query keys (stable strings)
  const startDateStr = format(startDate, "yyyy-MM-dd");
  const endDateStr = format(endDate, "yyyy-MM-dd");
  
  const dateRangeLabel = customDateRange?.from 
    ? `${format(startDate, "MMM d")} - ${format(endDate, "MMM d, yyyy")}`
    : `Last ${presetRange} days`;

  // Calculate previous period dates for comparison
  const rangeDays = differenceInDays(endDate, startDate) + 1;
  const prevEndDate = subDays(startDate, 1);
  const prevStartDate = subDays(prevEndDate, rangeDays - 1);

  // Fetch sales data
  const { data: salesData = [] } = useQuery({
    queryKey: ["reports-sales", restaurant?.id, branchId, startDateStr, endDateStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("sales_transactions")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q.order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch previous period sales
  const { data: prevSalesData = [] } = useQuery({
    queryKey: ["reports-sales-prev", restaurant?.id, branchId, format(prevStartDate, "yyyy-MM-dd"), format(prevEndDate, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("sales_transactions")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", startOfDay(prevStartDate).toISOString())
        .lte("created_at", endOfDay(prevEndDate).toISOString());
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q.order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id && showComparison,
  });

  // Fetch expenses data
  const { data: expensesData = [] } = useQuery({
    queryKey: ["reports-expenses", restaurant?.id, branchId, startDateStr, endDateStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("expenses")
        .select("*, expense_categories(*)")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .gte("expense_date", startDateStr)
        .lte("expense_date", endDateStr);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q.order("expense_date");
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Reconciled per-day sales — shared helper ensures Reports charts match the
  // Sales page "Filtered Total" and the Sales vs Expenses card everywhere.
  const { data: reconciledSales } = useReconciledSales({
    restaurantId: restaurant?.id,
    dateFrom: startDateStr,
    dateTo: endDateStr,
    branchId,
  });

  const adjustedSalesByDay = useMemo(
    () => ({
      summary: reconciledSales?.summaryByDay ?? new Map<string, number>(),
      adjustments: reconciledSales?.adjustmentsByDay ?? new Map<string, number>(),
    }),
    [reconciledSales]
  );

  const adjustDaySales = (dayStr: string, rawTxTotal: number): number =>
    reconcileDaySales(dayStr, rawTxTotal, {
      summaryByDay: adjustedSalesByDay.summary,
      adjustmentsByDay: adjustedSalesByDay.adjustments,
    });

  // Fetch previous period expenses
  const { data: prevExpensesData = [] } = useQuery({
    queryKey: ["reports-expenses-prev", restaurant?.id, branchId, format(prevStartDate, "yyyy-MM-dd"), format(prevEndDate, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("expenses")
        .select("*, expense_categories(*)")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .gte("expense_date", format(prevStartDate, "yyyy-MM-dd"))
        .lte("expense_date", format(prevEndDate, "yyyy-MM-dd"));
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q.order("expense_date");
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id && showComparison,
  });

  // Fetch shifts data
  const { data: shiftsData = [] } = useQuery({
    queryKey: ["reports-shifts", restaurant?.id, branchId, startDateStr, endDateStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("shifts")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .gte("opened_at", startDate.toISOString())
        .lte("opened_at", endDate.toISOString());
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q.order("opened_at");
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch overhead allocation data
  const { data: overheadData = [] } = useQuery({
    queryKey: ["reports-overhead", restaurant?.id, branchId],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("overhead_allocation")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch payroll records for labor cost (filter by period covered, not just payment date)
  const { data: payrollData = [] } = useQuery({
    queryKey: ["reports-payroll", restaurant?.id, branchId, startDateStr, endDateStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("payroll_records")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .or(`period_start.lte.${endDateStr},period_end.gte.${startDateStr}`);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch active staff for salary estimation when no payroll records exist
  const { data: staffData = [] } = useQuery({
    queryKey: ["reports-staff", restaurant?.id, branchId],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("staff")
        .select("id, name, payment_type, hourly_rate, monthly_salary, is_active")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true);
      if (branchId) q = q.eq("assigned_branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch inventory usage for food cost
  const { data: inventoryUsageData = [] } = useQuery({
    queryKey: ["reports-inventory-usage", restaurant?.id, branchId, startDateStr, endDateStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      // inventory_usage carries no branch column — scope via branch items.
      let itemIds: string[] | null = null;
      if (branchId) {
        const { data: bItems, error: bErr } = await supabase
          .from("inventory_items")
          .select("id")
          .eq("restaurant_id", restaurant.id)
          .eq("branch_id", branchId);
        if (bErr) throw bErr;
        itemIds = (bItems || []).map((i) => i.id);
        if (itemIds.length === 0) return [];
      }
      let q = supabase
        .from("inventory_usage")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .gte("usage_date", startDateStr)
        .lte("usage_date", endDateStr);
      if (itemIds) q = q.in("inventory_item_id", itemIds);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch purchases for COGS
  const { data: purchasesData = [] } = useQuery({
    queryKey: ["reports-purchases", restaurant?.id, branchId, startDateStr, endDateStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      let q = supabase
        .from("purchases")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .gte("received_at", startDate.toISOString())
        .lte("received_at", endDate.toISOString());
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Calculate daily sales chart data - use startOfDay for interval iteration
  const dailyData = eachDayOfInterval({ start: startOfDay(startDate), end: startOfDay(endDate) }).map((day) => {
    const dayStr = format(day, "yyyy-MM-dd");
    const rawDaySales = salesData
      .filter((s) => format(new Date(s.created_at), "yyyy-MM-dd") === dayStr)
      .reduce((sum, s) => sum + Number(s.total), 0);
    const daySales = adjustDaySales(dayStr, rawDaySales);
    const dayExpenses = expensesData
      .filter((e) => e.expense_date === dayStr)
      .reduce((sum, e) => sum + Number(e.amount), 0);
    return {
      date: format(day, "MMM d"),
      sales: daySales,
      expenses: dayExpenses,
      profit: daySales - dayExpenses,
    };
  });

  // Comparison data (day-by-day)
  const comparisonData = eachDayOfInterval({ start: startOfDay(startDate), end: startOfDay(endDate) }).map((day) => {
    const dayStr = format(day, "yyyy-MM-dd");
    const prevDay = subDays(day, rangeDays);
    const prevDayStr = format(prevDay, "yyyy-MM-dd");
    
    const rawDaySales = salesData
      .filter((s) => format(new Date(s.created_at), "yyyy-MM-dd") === dayStr)
      .reduce((sum, s) => sum + Number(s.total), 0);
    const daySales = adjustDaySales(dayStr, rawDaySales);
    
    const prevDaySales = prevSalesData
      .filter((s) => format(new Date(s.created_at), "yyyy-MM-dd") === prevDayStr)
      .reduce((sum, s) => sum + Number(s.total), 0);

    return {
      label: format(day, "MMM d"),
      current: daySales,
      previous: prevDaySales,
    };
  });

  const expenseComparisonData = eachDayOfInterval({ start: startOfDay(startDate), end: startOfDay(endDate) }).map((day) => {
    const dayStr = format(day, "yyyy-MM-dd");
    const prevDay = subDays(day, rangeDays);
    const prevDayStr = format(prevDay, "yyyy-MM-dd");
    
    const dayExpenses = expensesData
      .filter((e) => e.expense_date === dayStr)
      .reduce((sum, e) => sum + Number(e.amount), 0);
    
    const prevDayExpenses = prevExpensesData
      .filter((e) => e.expense_date === prevDayStr)
      .reduce((sum, e) => sum + Number(e.amount), 0);

    return {
      label: format(day, "MMM d"),
      current: dayExpenses,
      previous: prevDayExpenses,
    };
  });

  // Payment method breakdown
  const paymentBreakdown = salesData.reduce(
    (acc, sale) => {
      const method = sale.payment_method || "other";
      acc[method] = (acc[method] || 0) + Number(sale.total);
      return acc;
    },
    {} as Record<string, number>
  );

  const paymentChartData = Object.entries(paymentBreakdown).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
  }));

  // Expense category breakdown
  const expenseCategoryBreakdown = expensesData.reduce((acc, expense) => {
    const catName = expense.expense_categories?.name || "Uncategorized";
    acc[catName] = (acc[catName] || 0) + Number(expense.amount);
    return acc;
  }, {} as Record<string, number>);

  const expenseCategoryData = Object.entries(expenseCategoryBreakdown).map(([name, value]) => ({
    name,
    value,
  }));

  // Summary calculations
  const totalSales = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const s of salesData as any[]) {
      const k = format(new Date(s.created_at), "yyyy-MM-dd");
      perDay.set(k, (perDay.get(k) || 0) + Number(s.total || 0));
    }
    for (const [k, v] of adjustedSalesByDay.adjustments) {
      perDay.set(k, (perDay.get(k) || 0) + v);
    }
    for (const [k, v] of adjustedSalesByDay.summary) {
      perDay.set(k, v);
    }
    return Array.from(perDay.values()).reduce((s, v) => s + v, 0);
  }, [salesData, adjustedSalesByDay]);
  const totalExpenses = expensesData.reduce((sum, e) => sum + Number(e.amount), 0);
  const netProfit = totalSales - totalExpenses;
  const closedShifts = shiftsData.filter((s) => s.status === "closed");
  const avgVariance =
    closedShifts.length > 0
      ? closedShifts.reduce((sum, s) => sum + Math.abs(Number(s.variance || 0)), 0) / closedShifts.length
      : 0;

  // Previous period totals
  const prevTotalSales = prevSalesData.reduce((sum, s) => sum + Number(s.total), 0);
  const prevTotalExpenses = prevExpensesData.reduce((sum, e) => sum + Number(e.amount), 0);
  const prevNetProfit = prevTotalSales - prevTotalExpenses;

  // Advanced calculations - Labor cost from payroll records or estimated from staff salaries
  const payrollLaborCost = payrollData.reduce((sum, p) => {
    // Calculate the overlap between payroll period and selected date range
    const periodStart = new Date(p.period_start);
    const periodEnd = new Date(p.period_end);
    const rangeStart = startOfDay(startDate);
    const rangeEnd = startOfDay(endDate);
    
    // Calculate overlapping days
    const overlapStart = periodStart > rangeStart ? periodStart : rangeStart;
    const overlapEnd = periodEnd < rangeEnd ? periodEnd : rangeEnd;
    const overlapDays = Math.max(0, differenceInDays(overlapEnd, overlapStart) + 1);
    const totalPeriodDays = differenceInDays(periodEnd, periodStart) + 1;
    
    // Pro-rate the amount based on overlapping days
    const proRatedAmount = totalPeriodDays > 0 ? (Number(p.amount) * overlapDays) / totalPeriodDays : 0;
    return sum + proRatedAmount;
  }, 0);

  // Estimate labor from staff monthly salaries if no payroll records exist
  const estimatedMonthlyLabor = staffData.reduce((sum, s) => {
    if (s.payment_type === 'monthly' && s.monthly_salary) {
      return sum + Number(s.monthly_salary);
    } else if (s.payment_type === 'hourly' && s.hourly_rate) {
      // Estimate ~160 hours/month for hourly staff
      return sum + (Number(s.hourly_rate) * 160);
    }
    return sum;
  }, 0);
  
  // Pro-rate the estimated labor for the selected period
  const estimatedLaborForPeriod = (estimatedMonthlyLabor / 30) * rangeDays;
  
  // Use actual payroll if available, otherwise use estimated labor
  const laborCost = payrollLaborCost > 0 ? payrollLaborCost : estimatedLaborForPeriod;
  
  const foodCost = inventoryUsageData.reduce((sum, u) => sum + Number(u.total_cost), 0);
  const purchasesCost = purchasesData.reduce((sum, p) => sum + Number(p.total_cost), 0);
  
  // Use purchases as food cost if no usage tracking, otherwise use usage
  const effectiveFoodCost = foodCost > 0 ? foodCost : purchasesCost;
  
  // Daily overhead allocation
  const monthlyOverhead = overheadData.reduce((sum, o) => sum + Number(o.monthly_amount), 0);
  const dailyOverhead = monthlyOverhead / 30;
  const totalOverheadForPeriod = dailyOverhead * rangeDays;
  
  // Overhead items for P&L
  const overheadItems = overheadData.map(o => ({
    name: o.name,
    amount: (Number(o.monthly_amount) / 30) * rangeDays,
  }));

  // Other expenses - actual expenses from expenses table (operational costs like supplies, repairs, marketing, etc.)
  // These are recorded via the Expenses page and represent day-to-day operational spending
  const otherExpenses = totalExpenses;

  // Daily performance data for Top Performers
  const dailyPerformance = useMemo(() => {
    return eachDayOfInterval({ start: startOfDay(startDate), end: startOfDay(endDate) }).map((day) => {
      const dayStr = format(day, "yyyy-MM-dd");
      const rawDaySales = salesData
        .filter((s) => format(new Date(s.created_at), "yyyy-MM-dd") === dayStr)
        .reduce((sum, s) => sum + Number(s.total), 0);
      const daySales = adjustDaySales(dayStr, rawDaySales);
      const dayExpenses = expensesData
        .filter((e) => e.expense_date === dayStr)
        .reduce((sum, e) => sum + Number(e.amount), 0);
      const dayProfit = daySales - dayExpenses - dailyOverhead;
      const dayMargin = daySales > 0 ? (dayProfit / daySales) * 100 : 0;
      
      return {
        date: dayStr,
        sales: daySales,
        expenses: dayExpenses,
        profit: dayProfit,
        margin: dayMargin,
      };
    }).filter(d => d.sales > 0 || d.expenses > 0);
  }, [salesData, expensesData, startDate, endDate, dailyOverhead, adjustedSalesByDay]);

  // Expense categories for Top Performers
  const expenseCategoriesForTable = useMemo(() => {
    const categoryMap: Record<string, { total: number; count: number }> = {};
    expensesData.forEach((e) => {
      const catName = e.expense_categories?.name || "Uncategorized";
      if (!categoryMap[catName]) {
        categoryMap[catName] = { total: 0, count: 0 };
      }
      categoryMap[catName].total += Number(e.amount);
      categoryMap[catName].count += 1;
    });
    return Object.entries(categoryMap).map(([name, data]) => ({
      name,
      total: data.total,
      count: data.count,
      avgValue: data.count > 0 ? data.total / data.count : 0,
    }));
  }, [expensesData]);

  // Payment method breakdown for Top Performers
  const paymentMethodsForTable = useMemo(() => {
    const methodMap: Record<string, { total: number; count: number }> = {};
    salesData.forEach((s) => {
      const method = s.payment_method || "other";
      if (!methodMap[method]) {
        methodMap[method] = { total: 0, count: 0 };
      }
      methodMap[method].total += Number(s.total);
      methodMap[method].count += 1;
    });
    return Object.entries(methodMap).map(([method, data]) => ({
      method,
      total: data.total,
      count: data.count,
    }));
  }, [salesData]);

  const currentPeriodLabel = dateRangeLabel;
  const prevPeriodLabel = `${format(prevStartDate, "MMM d")} - ${format(prevEndDate, "MMM d")}`;

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="flex flex-col gap-4 fade-slide-in mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
                {t("app.reports.title")}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t("app.reports.subtitle", { currency: displayCurrency })}
              </p>
            </div>
            <BranchScopeSelector hint="All reports and charts below follow this branch" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button 
              variant={showComparison ? "default" : "outline"}
              size="sm"
              onClick={() => setShowComparison(!showComparison)}
              className="gap-1.5"
            >
              <GitCompare className="h-4 w-4" />
              <span className="hidden sm:inline">{t("app.reports.compare")}</span>
            </Button>
            <Select 
              value={customDateRange ? "custom" : presetRange} 
              onValueChange={(val) => {
                if (val !== "custom") {
                  setPresetRange(val);
                  setCustomDateRange(undefined);
                }
              }}
            >
              <SelectTrigger className="w-[120px] sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">{t("app.reports.ranges.last7")}</SelectItem>
                <SelectItem value="14">{t("app.reports.ranges.last14")}</SelectItem>
                <SelectItem value="30">{t("app.reports.ranges.last30")}</SelectItem>
                <SelectItem value="90">{t("app.reports.ranges.last90")}</SelectItem>
                {customDateRange && <SelectItem value="custom">{t("app.reports.ranges.custom")}</SelectItem>}
              </SelectContent>
            </Select>
            <DateRangePicker
              dateRange={customDateRange}
              onDateRangeChange={(range) => {
                setCustomDateRange(range);
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => trackFunnel("export_attempted")}
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("reports.export")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => {
                  const data = prepareSalesExportData(salesData, totalSales, dateRangeLabel);
                  exportToCSV(data);
                  toast.success(t("reports.exportedToast.salesCsv"));
                }}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  {t("reports.salesAsCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const data = prepareSalesExportData(salesData, totalSales, dateRangeLabel);
                  exportToPDF(data);
                }}>
                  <FileText className="h-4 w-4 mr-2" />
                  {t("reports.salesAsPdf")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const data = prepareExpensesExportData(expensesData, totalExpenses, dateRangeLabel);
                  exportToCSV(data);
                  toast.success(t("reports.exportedToast.expensesCsv"));
                }}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  {t("reports.expensesAsCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const data = prepareExpensesExportData(expensesData, totalExpenses, dateRangeLabel);
                  exportToPDF(data);
                }}>
                  <FileText className="h-4 w-4 mr-2" />
                  {t("reports.expensesAsPdf")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const data = prepareShiftsExportData(shiftsData, dateRangeLabel);
                  exportToCSV(data);
                  toast.success(t("reports.exportedToast.shiftsCsv"));
                }}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  {t("reports.shiftsAsCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const data = prepareShiftsExportData(shiftsData, dateRangeLabel);
                  exportToPDF(data);
                }}>
                  <FileText className="h-4 w-4 mr-2" />
                  {t("reports.shiftsAsPdf")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {hasEmailReports ? (
              <Button variant="outline" size="sm" onClick={() => setScheduleDialogOpen(true)} className="gap-1.5">
                <CalendarClock className="h-4 w-4" />
                <span className="hidden sm:inline">{t("reports.schedule")}</span>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled className="gap-1.5 opacity-50">
                <Lock className="h-4 w-4" />
                <span className="hidden sm:inline">{t("reports.schedule")}</span>
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">Pro</Badge>
              </Button>
            )}
          </div>
        </header>

        {/* KPI Summary */}
        {showComparison ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
            <KPIComparison
              title="Total Sales"
              icon={DollarSign}
              currentValue={totalSales}
              previousValue={prevTotalSales}
              currentLabel={currentPeriodLabel}
              previousLabel={prevPeriodLabel}
              formatter={(v) => formatCurrency(v)}
              delay={50}
            />
            <KPIComparison
              title="Total Expenses"
              icon={TrendingDown}
              currentValue={totalExpenses}
              previousValue={prevTotalExpenses}
              currentLabel={currentPeriodLabel}
              previousLabel={prevPeriodLabel}
              formatter={(v) => formatCurrency(v)}
              inverseColors
              delay={100}
            />
            <KPIComparison
              title="Net Profit"
              icon={TrendingUp}
              currentValue={netProfit}
              previousValue={prevNetProfit}
              currentLabel={currentPeriodLabel}
              previousLabel={prevPeriodLabel}
              formatter={(v) => formatCurrency(v)}
              delay={150}
            />
            <Card className="fade-slide-in" style={{ animationDelay: "200ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Avg Cash Variance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`font-display text-2xl font-semibold tabular-nums ${avgVariance <= 10 ? "text-success" : avgVariance <= 50 ? "text-warning" : "text-destructive"}`}>
                  ±{formatCurrency(avgVariance)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {closedShifts.length} shifts closed
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
            <Card className="fade-slide-in" style={{ animationDelay: "50ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Total Sales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-display text-2xl font-semibold tabular-nums text-foreground">
                  {formatCurrency(totalSales)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {salesData.length} transactions
                </p>
              </CardContent>
            </Card>

            <Card className="fade-slide-in" style={{ animationDelay: "100ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" />
                  Total Expenses
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-display text-2xl font-semibold tabular-nums text-foreground">
                  {formatCurrency(totalExpenses)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {expensesData.length} expenses
                </p>
              </CardContent>
            </Card>

            <Card className="fade-slide-in" style={{ animationDelay: "150ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Net Profit
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`font-display text-2xl font-semibold tabular-nums ${netProfit >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatCurrency(netProfit)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {((netProfit / (totalSales || 1)) * 100).toFixed(1)}% margin
                </p>
              </CardContent>
            </Card>

            <Card className="fade-slide-in" style={{ animationDelay: "200ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Avg Cash Variance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`font-display text-2xl font-semibold tabular-nums ${avgVariance <= 10 ? "text-success" : avgVariance <= 50 ? "text-warning" : "text-destructive"}`}>
                  ±{formatCurrency(avgVariance)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {closedShifts.length} shifts closed
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts */}
        <Tabs defaultValue="overview" className="mt-8">
          <TabsList className="fade-slide-in flex-wrap h-auto gap-1" style={{ animationDelay: "250ms" }}>
            <TabsTrigger value="overview">{t("app.reports.tabs.overview")}</TabsTrigger>
            {hasAdvancedReports && <TabsTrigger value="financial">{t("app.reports.tabs.financial")}</TabsTrigger>}
            {hasAdvancedReports && <TabsTrigger value="pl">{t("app.reports.tabs.pl")}</TabsTrigger>}
            {hasAdvancedReports && <TabsTrigger value="analysis">{t("app.reports.tabs.analysis")}</TabsTrigger>}
            {hasAdvancedReports && <TabsTrigger value="margins">{t("app.reports.tabs.margins")}</TabsTrigger>}
            <TabsTrigger value="sales">{t("app.reports.tabs.sales")}</TabsTrigger>
            <TabsTrigger value="expenses">{t("app.reports.tabs.expenses")}</TabsTrigger>
            <TabsTrigger value="shifts">{t("app.reports.tabs.shifts")}</TabsTrigger>
            {hasMultipleBranches && <TabsTrigger value="branches">{t("app.reports.tabs.branches")}</TabsTrigger>}
            {showComparison && <TabsTrigger value="comparison">{t("app.reports.tabs.comparison")}</TabsTrigger>}
            {!hasAdvancedReports && (
              <div className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                <span>{t("app.reports.advancedTabs")}</span>
                <Badge variant="secondary" className="text-[10px] px-1">Pro</Badge>
              </div>
            )}
          </TabsList>

          {/* Financial Analysis Tab - Pro feature */}
          {hasAdvancedReports && (
            <TabsContent value="financial" className="space-y-6 mt-6">
              <AdvancedReportMetrics
                totalSales={totalSales}
                foodCost={effectiveFoodCost}
                laborCost={laborCost}
                overheadCost={totalOverheadForPeriod}
                otherExpenses={otherExpenses}
                rangeDays={rangeDays}
              />
              <CostBreakdownChart
                netSales={totalSales}
                foodCost={effectiveFoodCost}
                laborCost={laborCost}
                overheadCost={totalOverheadForPeriod}
                otherExpenses={otherExpenses}
                profit={totalSales - effectiveFoodCost - laborCost - totalOverheadForPeriod - otherExpenses}
              />
            </TabsContent>
          )}

          {/* P&L Statement Tab - Pro feature */}
          {hasAdvancedReports && (
            <TabsContent value="pl" className="space-y-6 mt-6">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <AutoPostExpensesButton
                  fromDate={startDateStr}
                  toDate={endDateStr}
                  branchId={branchId}
                />
              </div>
              <ProfitLossStatement
                dateRange={dateRangeLabel}
                branchLabel={branchScopeLabel}
                totalSales={totalSales}
                discounts={0}
                refunds={0}
                foodCost={effectiveFoodCost}
                beverageCost={0}
                laborCost={laborCost}
                overheadItems={overheadItems}
                otherExpenses={otherExpenses}
              />
            </TabsContent>
          )}

          {/* Analysis Tab - Pro feature */}
          {hasAdvancedReports && (
            <TabsContent value="analysis" className="space-y-6 mt-6">
              <TopPerformersTable
                dailyPerformance={dailyPerformance}
                expensesByCategory={expenseCategoriesForTable}
                paymentMethodBreakdown={paymentMethodsForTable}
              />
            </TabsContent>
          )}

          {/* Margins Tab - Pro feature */}
          {hasAdvancedReports && (
            <TabsContent value="margins" className="space-y-6 mt-6">
              <CategoryMarginReport dateRange={{ from: startDate, to: endDate }} />
            </TabsContent>
          )}

          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* Sales vs Expenses Chart */}
            <Card className="fade-slide-in">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">{t("reports.salesVsExpenses")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[300px] w-full">
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" className="text-xs fill-muted-foreground" />
                    <YAxis className="text-xs fill-muted-foreground" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="sales" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" fill="hsl(var(--chart-5))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Payment Methods */}
              <Card className="fade-slide-in">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">{t("reports.paymentMethods")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {paymentChartData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[250px] w-full">
                      <PieChart>
                        <Pie
                          data={paymentChartData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {paymentChartData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ChartContainer>
                  ) : (
                    <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                      No sales data
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Expense Categories */}
              <Card className="fade-slide-in">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium">{t("reports.expenseCategories")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {expenseCategoryData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[250px] w-full">
                      <PieChart>
                        <Pie
                          data={expenseCategoryData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {expenseCategoryData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ChartContainer>
                  ) : (
                    <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                      No expense data
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="sales" className="space-y-6 mt-6">
            <Card className="fade-slide-in">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">{t("reports.dailySalesTrend")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[350px] w-full">
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" className="text-xs fill-muted-foreground" />
                    <YAxis className="text-xs fill-muted-foreground" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="sales"
                      stroke="hsl(var(--chart-1))"
                      strokeWidth={2}
                      dot={{ fill: "hsl(var(--chart-1))" }}
                    />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="expenses" className="space-y-6 mt-6">
            <Card className="fade-slide-in">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">{t("reports.dailyExpensesTrend")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[350px] w-full">
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" className="text-xs fill-muted-foreground" />
                    <YAxis className="text-xs fill-muted-foreground" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="expenses"
                      stroke="hsl(var(--chart-5))"
                      strokeWidth={2}
                      dot={{ fill: "hsl(var(--chart-5))" }}
                    />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="shifts" className="space-y-6 mt-6">
            <Card className="fade-slide-in">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">{t("reports.shiftSummary")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground">{t("reports.totalShifts")}</p>
                    <p className="font-display text-2xl font-semibold tabular-nums mt-1">{shiftsData.length}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground">{t("reports.closedShifts")}</p>
                    <p className="font-display text-2xl font-semibold tabular-nums mt-1">{closedShifts.length}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground">{t("reports.perfectCloses")}</p>
                    <p className="font-display text-2xl font-semibold tabular-nums mt-1 text-success">
                      {closedShifts.filter((s) => Math.abs(Number(s.variance || 0)) < 1).length}
                    </p>
                  </div>
                </div>
                <div className="mt-6">
                  <h4 className="text-sm font-medium mb-3">{t("reports.varianceDistribution")}</h4>
                  <ChartContainer config={chartConfig} className="h-[250px] w-full">
                    <BarChart
                      data={closedShifts.map((s, i) => ({
                        shift: `Shift ${i + 1}`,
                        variance: Number(s.variance || 0),
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="shift" className="text-xs fill-muted-foreground" />
                      <YAxis className="text-xs fill-muted-foreground" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="variance"
                        fill="hsl(var(--chart-4))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>
            <BranchShiftSummaryReport startDate={startDate} endDate={endDate} />
          </TabsContent>

          {hasMultipleBranches && (
            <TabsContent value="branches" className="space-y-6 mt-6">
              <BranchComparisonReport startDate={startDate} endDate={endDate} />
            </TabsContent>
          )}

          {showComparison && (
            <TabsContent value="comparison" className="space-y-6 mt-6">
              <ComparisonChart
                title="Sales Comparison"
                data={comparisonData}
                currentLabel={currentPeriodLabel}
                previousLabel={prevPeriodLabel}
                valueFormatter={(v) => formatCurrency(v)}
              />
              <ComparisonChart
                title="Expenses Comparison"
                data={expenseComparisonData}
                currentLabel={currentPeriodLabel}
                previousLabel={prevPeriodLabel}
                valueFormatter={(v) => formatCurrency(v)}
              />
            </TabsContent>
          )}
        </Tabs>

        {/* Scheduled Reports Section - Pro feature */}
        {hasEmailReports && (
          <div className="mt-8 fade-slide-in" style={{ animationDelay: "400ms" }}>
            <ReportSchedulesList />
          </div>
        )}
      </div>

      {hasEmailReports && (
        <ReportScheduleDialog
          open={scheduleDialogOpen}
          onOpenChange={setScheduleDialogOpen}
          onScheduleCreated={() => {
            queryClient.invalidateQueries({ queryKey: ["report-schedules"] });
          }}
        />
      )}
    </>
  );
}
