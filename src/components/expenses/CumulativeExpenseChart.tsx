import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, eachDayOfInterval, parseISO, startOfDay, endOfDay } from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BranchTotalsExplainerTooltip } from "@/components/branches/BranchTotalsExplainer";
import { useCurrency } from "@/hooks/useCurrency";
import { TrendingUp, Info, ChevronDown, ChevronUp } from "lucide-react";
import { useReconciledSales, buildDayBreakdown } from "@/lib/reconciledSales";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  restaurantId?: string;
  dateFrom: string;
  dateTo: string;
  /** Optional branch scope. */
  branchId?: string | null;
}

type Basis = "cash" | "invoice";

export function CumulativeExpenseChart({ restaurantId, dateFrom, dateTo, branchId = null }: Props) {
  const { format: formatCurrency } = useCurrency();
  const { t } = useTranslation();
  const [basis, setBasis] = useState<Basis>("cash");
  const [showBreakdown, setShowBreakdown] = useState(false);

  const { data: expenseRows = [], isLoading: isLoadingExpenses } = useQuery({
    queryKey: ["expenses-cumulative", restaurantId, dateFrom, dateTo, branchId],
    enabled: !!restaurantId && !!dateFrom && !!dateTo,
    queryFn: async () => {
      let eq = supabase
        .from("expenses")
        .select("amount, expense_date")
        .eq("restaurant_id", restaurantId!)
        .is("deleted_at", null)
        .gte("expense_date", dateFrom)
        .lte("expense_date", dateTo);
      if (branchId) eq = eq.eq("branch_id", branchId);
      const { data, error } = await eq.order("expense_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: reconciled, isLoading: isLoadingSales } = useReconciledSales({
    restaurantId,
    dateFrom,
    dateTo,
    branchId,
  });

  // Per-day unpaid (settlement_status = 'unpaid' or null) — drives the
  // "Invoice basis" line and the Outstanding KPI.
  const { data: unpaidByDay, isLoading: isLoadingUnpaid } = useQuery({
    queryKey: ["sales-unpaid-by-day", restaurantId, dateFrom, dateTo, branchId],
    enabled: !!restaurantId && !!dateFrom && !!dateTo,
    queryFn: async () => {
      const startISO = startOfDay(parseISO(dateFrom)).toISOString();
      const endISO = endOfDay(parseISO(dateTo)).toISOString();
      let sq = supabase
        .from("sales_transactions")
        .select("total, created_at, settlement_status")
        .eq("restaurant_id", restaurantId!)
        .gte("created_at", startISO)
        .lte("created_at", endISO);
      if (branchId) sq = sq.eq("branch_id", branchId);
      const { data, error } = await sq;
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of (data || []) as any[]) {
        if (r.settlement_status && r.settlement_status !== "unpaid") continue;
        const k = format(new Date(r.created_at), "yyyy-MM-dd");
        map.set(k, (map.get(k) || 0) + Number(r.total || 0));
      }
      return map;
    },
  });

  const chartData = useMemo(() => {
    if (!dateFrom || !dateTo) return [];
    const start = parseISO(dateFrom);
    const end = parseISO(dateTo);
    if (start > end) return [];
    const expenseTotals = new Map<string, number>();
    for (const row of expenseRows as any[]) {
      const k = row.expense_date as string;
      expenseTotals.set(k, (expenseTotals.get(k) || 0) + Number(row.amount || 0));
    }
    const reconciledByDay = reconciled?.perDay ?? new Map<string, number>();
    const rawByDay = reconciled?.rawTxByDay ?? new Map<string, number>();
    let runningExp = 0;
    let runningSales = 0;
    return eachDayOfInterval({ start, end }).map((d) => {
      const key = format(d, "yyyy-MM-dd");
      runningExp += expenseTotals.get(key) || 0;
      const daily = basis === "cash"
        ? reconciledByDay.get(key) || 0
        : rawByDay.get(key) || 0;
      runningSales += daily;
      return {
        date: key,
        label: format(d, "MMM d"),
        dailyExpenses: expenseTotals.get(key) || 0,
        cumulativeExpenses: runningExp,
        dailySales: daily,
        cumulativeSales: runningSales,
      };
    });
  }, [expenseRows, reconciled, dateFrom, dateTo, basis]);

  const totalExpenses = chartData.length ? chartData[chartData.length - 1].cumulativeExpenses : 0;
  const totalSales = chartData.length ? chartData[chartData.length - 1].cumulativeSales : 0;
  const isLoading = isLoadingExpenses || isLoadingSales || isLoadingUnpaid;

  // KPI totals across the range.
  const reconciledTotal = useMemo(
    () => Array.from(reconciled?.perDay?.values() ?? []).reduce((s, v) => s + v, 0),
    [reconciled],
  );
  const invoiceTotal = useMemo(
    () => Array.from(reconciled?.rawTxByDay?.values() ?? []).reduce((s, v) => s + v, 0),
    [reconciled],
  );
  const unpaidTotal = useMemo(
    () => Array.from(unpaidByDay?.values() ?? []).reduce((s, v) => s + v, 0),
    [unpaidByDay],
  );
  const gap = invoiceTotal - reconciledTotal;

  // Per-day breakdown rows (only days where raw or summary differ).
  const breakdownRows = useMemo(() => {
    if (!reconciled) return [] as Array<{
      date: string;
      rawPos: number;
      adjustments: number;
      final: number;
      unpaid: number;
      source: "summary" | "adjusted" | "raw";
      delta: number;
    }>;
    const keys = new Set<string>([
      ...reconciled.rawTxByDay.keys(),
      ...reconciled.summaryByDay.keys(),
      ...reconciled.adjustmentsByDay.keys(),
      ...(unpaidByDay ? Array.from(unpaidByDay.keys()) : []),
    ]);
    return Array.from(keys)
      .sort()
      .map((k) => {
        const b = buildDayBreakdown(k, reconciled);
        return {
          date: k,
          rawPos: b.rawPos,
          adjustments: b.adjustments,
          final: b.final,
          unpaid: unpaidByDay?.get(k) || 0,
          source: b.source,
          delta: b.rawPos - b.final,
        };
      })
      .filter((r) => r.rawPos !== r.final || r.unpaid > 0);
  }, [reconciled, unpaidByDay]);

  return (
    <TooltipProvider delayDuration={150}>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2 pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          {t("app.expenses.charts.cumulativeTitle")}
          <BranchTotalsExplainerTooltip />
        </CardTitle>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {t("app.expenses.summary.expenses")}: <span className="font-semibold text-foreground">{formatCurrency(totalExpenses)}</span>
          </span>
          <span className="text-muted-foreground flex items-center gap-1">
            {t("app.expenses.summary.sales")}:
            <span className="font-semibold" style={{ color: "hsl(var(--success))" }}>{formatCurrency(totalSales)}</span>
            <UiTooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" aria-label="Sales basis info" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs leading-snug">
                {basis === "cash" ? (
                  <>
                    <strong>Cash basis (reconciled)</strong> excludes unpaid /
                    on-account sales and voided transactions, and applies the
                    operator's day-end adjusted total when a day has been closed.
                  </>
                ) : (
                  <>
                    <strong>Invoice basis</strong> shows the raw POS total of
                    every issued transaction in the period, including unpaid /
                    on-account sales. Matches the Sales page Filtered Total.
                  </>
                )}
              </TooltipContent>
            </UiTooltip>
          </span>
        </div>
      </CardHeader>

      {/* Basis toggle + KPI strip */}
      <div className="px-6 pb-2 flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Tabs value={basis} onValueChange={(v) => setBasis(v as Basis)}>
            <TabsList className="h-8">
              <TabsTrigger value="cash" className="text-xs px-3 h-6">{t("app.expenses.charts.cashBasis")}</TabsTrigger>
              <TabsTrigger value="invoice" className="text-xs px-3 h-6">{t("app.expenses.charts.invoiceBasis")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setShowBreakdown((s) => !s)}
          >
            {t("app.expenses.charts.breakdown")}
            {showBreakdown ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("app.expenses.charts.invoiceTotal")}</div>
            <div className="text-sm font-semibold tabular-nums">{formatCurrency(invoiceTotal)}</div>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("app.expenses.charts.reconciledCash")}</div>
            <div className="text-sm font-semibold tabular-nums" style={{ color: "hsl(var(--success))" }}>
              {formatCurrency(reconciledTotal)}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("app.expenses.charts.outstanding")}</div>
            <div className="text-sm font-semibold tabular-nums text-amber-600">
              {formatCurrency(unpaidTotal)}
            </div>
          </div>
        </div>
        {Math.abs(gap) > 0.01 && (
          <div className="text-[11px] text-muted-foreground">
            {t("app.expenses.charts.basisGap", { amount: formatCurrency(Math.abs(gap)) })}
          </div>
        )}
      </div>

      <CardContent>
        {isLoading ? (
          <div className="h-56 skeleton-shimmer rounded" />
        ) : chartData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
            Select a date range to see cumulative expenses and sales
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cumExpFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cumSalesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={70}
                tickFormatter={(v) => formatCurrency(Number(v))}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number, name: string) => [
                  formatCurrency(Number(value)),
                  name === "cumulativeExpenses"
                    ? "Cumulative Expenses"
                    : basis === "cash"
                      ? "Cumulative Sales (reconciled)"
                      : "Cumulative Sales (invoice)",
                ]}
                labelFormatter={(l) => l}
              />
              <Area
                type="monotone"
                dataKey="cumulativeExpenses"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#cumExpFill)"
              />
              <Area
                type="monotone"
                dataKey="cumulativeSales"
                stroke="hsl(var(--success))"
                strokeWidth={2}
                fill="url(#cumSalesFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {showBreakdown && (
          <div className="mt-4 border-t pt-3">
            <div className="text-xs font-medium mb-2 flex items-center gap-2">
              Per-day reconciliation
              <span className="text-muted-foreground font-normal">
                ({breakdownRows.length} day{breakdownRows.length === 1 ? "" : "s"} with adjustments or unpaid)
              </span>
            </div>
            {breakdownRows.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">
                No reconciliation differences in this range — raw POS equals reconciled sales.
              </div>
            ) : (
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left font-medium py-1.5 pr-2">Date</th>
                      <th className="text-right font-medium py-1.5 px-2">Raw POS</th>
                      <th className="text-right font-medium py-1.5 px-2">Adjust.</th>
                      <th className="text-right font-medium py-1.5 px-2">Final</th>
                      <th className="text-right font-medium py-1.5 px-2">Unpaid</th>
                      <th className="text-right font-medium py-1.5 pl-2">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdownRows.map((r) => (
                      <tr key={r.date} className="border-b last:border-0">
                        <td className="py-1.5 pr-2">{r.date}</td>
                        <td className="text-right py-1.5 px-2">{formatCurrency(r.rawPos)}</td>
                        <td className="text-right py-1.5 px-2 text-muted-foreground">
                          {r.adjustments ? formatCurrency(r.adjustments) : "—"}
                        </td>
                        <td className="text-right py-1.5 px-2 font-medium">{formatCurrency(r.final)}</td>
                        <td className="text-right py-1.5 px-2 text-amber-600">
                          {r.unpaid ? formatCurrency(r.unpaid) : "—"}
                        </td>
                        <td className="text-right py-1.5 pl-2">
                          <Badge
                            variant="outline"
                            className="text-[10px] h-4 px-1.5 font-normal"
                          >
                            {r.source === "summary"
                              ? "Closed day"
                              : r.source === "adjusted"
                                ? "Adjusted"
                                : "Raw"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              Excluded from cash basis: unpaid / on-account sales and voided
              transactions. Days marked “Closed day” use the operator-reconciled
              Adjusted Total from Daily Sales, which overrides the raw POS sum.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}

export default CumulativeExpenseChart;