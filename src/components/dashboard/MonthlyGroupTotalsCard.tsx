import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, RefreshCw, Info, ChevronDown, CalendarIcon, X, Columns3 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  format as formatDate,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfWeek,
  subWeeks,
  endOfWeek,
  subDays,
  addDays,
  addMonths,
  addWeeks,
  isAfter,
} from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import {
  GroupTotalsDrilldownDialog,
  type DrilldownTarget,
} from "./GroupTotalsDrilldownDialog";
import { BranchMultiSelect } from "./BranchMultiSelect";
import { Toggle } from "@/components/ui/toggle";

type Granularity = "month" | "week" | "day";

type CompareMetric = "sales" | "expenses" | "net";

/** Distinct series colours for branch comparison bars. */
const COMPARE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(199 89% 48%)",
  "hsl(45 93% 47%)",
  "hsl(280 65% 60%)",
  "hsl(150 60% 40%)",
  "hsl(20 90% 55%)",
  "hsl(215 25% 45%)",
];

const BUCKET_COUNT: Record<Granularity, number> = { month: 12, week: 12, day: 14 };

const GRANULARITY_LABEL: Record<Granularity, string> = {
  month: "last 12 months",
  week: "last 12 weeks",
  day: "last 14 days",
};

const PERIOD_COLUMN: Record<Granularity, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

const TOTALS_SUFFIX: Record<Granularity, string> = { month: "12m", week: "12w", day: "14d" };

interface MonthRow {
  key: string; // bucket key (yyyy-MM | yyyy-MM-dd)
  label: string;
  sales: number;
  expenses: number;
  net: number;
  /** Per-branch metric values keyed by `b_<branchId>` (compare mode). */
  [seriesKey: string]: any;
}

/**
 * Group-wide monthly sales vs expenses (all branches combined), rendered as a
 * bar chart for the last 12 months. Companion to the daily group totals card.
 */
export function MonthlyGroupTotalsCard() {
  const { restaurant } = useAuth();
  const { branches } = useBranch();
  const { format: money } = useCurrency();
  const restaurantId = restaurant?.id;
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [drilldown, setDrilldown] = useState<DrilldownTarget | null>(null);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange | undefined>();
  const [compareMode, setCompareMode] = useState(false);
  const [compareMetric, setCompareMetric] = useState<CompareMetric>("sales");

  const customRange = range?.from && range?.to ? { from: range.from, to: range.to } : null;

  const branchKey = [...branchIds].sort().join(",");

  const activeBranches = useMemo(
    () => (branches ?? []).filter((b: any) => b.is_active !== false),
    [branches],
  );

  /** Branches shown as separate series in compare mode. */
  const compareBranches = useMemo(() => {
    const list = branchIds.length
      ? activeBranches.filter((b: any) => branchIds.includes(b.id))
      : activeBranches;
    return list.slice(0, COMPARE_COLORS.length) as { id: string; name: string }[];
  }, [activeBranches, branchIds]);
  const branchScopeLabel =
    branchIds.length === 0
      ? "every branch"
      : branchIds.length === 1
        ? branches.find((b) => b.id === branchIds[0])?.name ?? "1 branch"
        : `${branchIds.length} branches`;

  const openDrilldown = (row: { key: string; label: string }) => {
    if (!row?.key) return;
    let start: Date;
    let end: Date;
    if (granularity === "month") {
      start = new Date(`${row.key}-01T00:00:00`);
      end = endOfMonth(start);
    } else if (granularity === "week") {
      start = new Date(`${row.key}T00:00:00`);
      end = addDays(start, 6);
    } else {
      start = new Date(`${row.key}T00:00:00`);
      end = start;
    }
    setDrilldown({
      key: row.key,
      label: row.label,
      granularity,
      startDate: formatDate(start, "yyyy-MM-dd"),
      endDate: formatDate(end, "yyyy-MM-dd"),
      branchIds,
      branchLabel: branchScopeLabel === "every branch" ? "all branches" : branchScopeLabel,
      compare: compareMode,
    });
  };

  const { startKey, endKey, months, bucketOf } = useMemo(() => {
    const now = new Date();
    const count = BUCKET_COUNT[granularity] - 1;
    const list: MonthRow[] = [];
    let first: Date;
    let last: Date;
    let bucketOf: (isoDate: string) => string;

    if (granularity === "month") {
      first = customRange ? customRange.from : startOfMonth(subMonths(now, count));
      last = customRange ? customRange.to : new Date(now.getFullYear(), now.getMonth() + 1, 0);
      let cursor = startOfMonth(first);
      const stop = startOfMonth(last);
      while (!isAfter(cursor, stop)) {
        list.push({ key: formatDate(cursor, "yyyy-MM"), label: formatDate(cursor, "MMM yy"), sales: 0, expenses: 0, net: 0 });
        cursor = addMonths(cursor, 1);
      }
      bucketOf = (iso) => iso.slice(0, 7);
    } else if (granularity === "week") {
      first = startOfWeek(customRange ? customRange.from : subWeeks(now, count), { weekStartsOn: 6 });
      last = endOfWeek(customRange ? customRange.to : now, { weekStartsOn: 6 });
      let cursor = first;
      while (!isAfter(cursor, last)) {
        list.push({ key: formatDate(cursor, "yyyy-MM-dd"), label: formatDate(cursor, "d MMM"), sales: 0, expenses: 0, net: 0 });
        cursor = addWeeks(cursor, 1);
      }
      bucketOf = (iso) =>
        formatDate(startOfWeek(new Date(`${iso}T00:00:00`), { weekStartsOn: 6 }), "yyyy-MM-dd");
    } else {
      first = customRange ? customRange.from : subDays(now, count);
      last = customRange ? customRange.to : now;
      const lastKey = formatDate(last, "yyyy-MM-dd");
      let cursor = first;
      for (let guard = 0; guard < 400; guard++) {
        const key = formatDate(cursor, "yyyy-MM-dd");
        list.push({ key, label: formatDate(cursor, "d MMM"), sales: 0, expenses: 0, net: 0 });
        if (key >= lastKey) break;
        cursor = addDays(cursor, 1);
      }
      bucketOf = (iso) => iso.slice(0, 10);
    }

    return {
      startKey: formatDate(first, "yyyy-MM-dd"),
      endKey: formatDate(last, "yyyy-MM-dd"),
      months: list,
      bucketOf,
    };
  }, [granularity, customRange?.from?.getTime(), customRange?.to?.getTime()]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: [
      "dashboard-monthly-group-totals",
      restaurantId,
      granularity,
      startKey,
      endKey,
      branchKey,
      compareMode,
    ],
    enabled: !!restaurantId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // Page through results: a single request is capped at 1,000 rows, which
      // silently truncated a year of expenses and understated recent months.
      const fetchAll = async (build: () => any) => {
        const PAGE = 1000;
        const all: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await build().range(from, from + PAGE - 1);
          if (error) return { data: null, error };
          all.push(...(data ?? []));
          if (!data || data.length < PAGE) break;
        }
        return { data: all, error: null };
      };
      const buildSales = () => {
        let q = supabase
          .from("daily_sales_summary")
          .select("id, sales_date, total_sales, branch_id")
          .eq("restaurant_id", restaurantId!)
          .gte("sales_date", startKey)
          .lte("sales_date", endKey);
        if (branchIds.length) q = q.in("branch_id", branchIds);
        return q.order("id", { ascending: true });
      };
      const buildExpenses = () => {
        let q = supabase
          .from("expenses")
          .select("id, expense_date, amount, branch_id")
          .eq("restaurant_id", restaurantId!)
          .is("deleted_at", null)
          .gte("expense_date", startKey)
          .lte("expense_date", endKey);
        if (branchIds.length) q = q.in("branch_id", branchIds);
        return q.order("id", { ascending: true });
      };
      const [salesRes, expenseRes] = await Promise.all([fetchAll(buildSales), fetchAll(buildExpenses)]);
      if (salesRes.error) throw salesRes.error;
      if (expenseRes.error) throw expenseRes.error;

      const byMonth = new Map<string, MonthRow>();
      months.forEach((m) => byMonth.set(m.key, { ...m }));
      const branchTotals = new Map<string, { sales: number; expenses: number }>();
      const bumpBranch = (id: string | null, field: "sales" | "expenses", value: number) => {
        const bid = id ?? "unassigned";
        const cur = branchTotals.get(bid) ?? { sales: 0, expenses: 0 };
        cur[field] += value;
        branchTotals.set(bid, cur);
      };

      (salesRes.data ?? []).forEach((r: any) => {
        const key = bucketOf(String(r.sales_date));
        const row = byMonth.get(key);
        const value = Number(r.total_sales || 0);
        bumpBranch(r.branch_id ?? null, "sales", value);
        if (row) {
          row.sales += value;
          const sk = `s_${r.branch_id ?? "unassigned"}`;
          row[sk] = (row[sk] ?? 0) + value;
        }
      });
      (expenseRes.data ?? []).forEach((r: any) => {
        const key = bucketOf(String(r.expense_date));
        const row = byMonth.get(key);
        const value = Number(r.amount || 0);
        bumpBranch(r.branch_id ?? null, "expenses", value);
        if (row) {
          row.expenses += value;
          const ek = `e_${r.branch_id ?? "unassigned"}`;
          row[ek] = (row[ek] ?? 0) + value;
        }
      });

      const rows = [...byMonth.values()].map((r) => ({ ...r, net: r.sales - r.expenses }));
      return {
        rows,
        totalSales: rows.reduce((s, r) => s + r.sales, 0),
        totalExpenses: rows.reduce((s, r) => s + r.expenses, 0),
        branchTotals: Object.fromEntries(branchTotals),
      };
    },
  });

  const rows = data?.rows ?? months;
  const totalSales = data?.totalSales ?? 0;
  const totalExpenses = data?.totalExpenses ?? 0;
  const net = totalSales - totalExpenses;

  const compact = (v: number) =>
    Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));

  const periodLabel = customRange
    ? `${formatDate(customRange.from, "d MMM yyyy")} – ${formatDate(customRange.to, "d MMM yyyy")}`
    : GRANULARITY_LABEL[granularity];
  const totalsSuffix = customRange ? "selected range" : TOTALS_SUFFIX[granularity];

  const metricValue = (row: any, branchId: string) => {
    const s = Number(row[`s_${branchId}`] ?? 0);
    const e = Number(row[`e_${branchId}`] ?? 0);
    return compareMetric === "sales" ? s : compareMetric === "expenses" ? e : s - e;
  };

  /** Rows enriched with one numeric field per compared branch. */
  const chartRows = useMemo(() => {
    if (!compareMode) return rows;
    return rows.map((r: any) => {
      const out: any = { key: r.key, label: r.label };
      compareBranches.forEach((b) => {
        out[`b_${b.id}`] = metricValue(r, b.id);
      });
      return out;
    });
  }, [rows, compareMode, compareBranches, compareMetric]);

  const compareTotals = compareBranches.map((b, i) => {
    const t = (data?.branchTotals as any)?.[b.id] ?? { sales: 0, expenses: 0 };
    return {
      ...b,
      color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      sales: Number(t.sales || 0),
      expenses: Number(t.expenses || 0),
      net: Number(t.sales || 0) - Number(t.expenses || 0),
    };
  });

  return (
    <Card className="border-border/40 h-full">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3">
          <div className="min-w-0 w-full">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">
                Group totals — {granularity === "month" ? "month by month" : granularity === "week" ? "week by week" : "day by day"}
              </span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 break-words">
              {compareMode
                ? `Comparing ${compareMetric} for ${compareBranches.length} branches`
                : `Sales vs expenses across ${branchScopeLabel}`}{" "}
              · {periodLabel} · click a bar for details
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full">
            <Toggle
              size="sm"
              pressed={compareMode}
              onPressedChange={setCompareMode}
              aria-label="Compare branches side by side"
              className="h-8 px-2 text-xs data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            >
              <Columns3 className="h-3.5 w-3.5 mr-1" /> Compare
            </Toggle>
            {compareMode && (
              <Select
                value={compareMetric}
                onValueChange={(v) => setCompareMetric(v as CompareMetric)}
              >
                <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="Compare metric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="expenses">Expenses</SelectItem>
                  <SelectItem value="net">Net</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Select date range"
                  className={cn(
                    "h-8 justify-start gap-1.5 text-xs font-normal",
                    !customRange && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  <span className="truncate max-w-[150px]">
                    {customRange
                      ? `${formatDate(customRange.from, "d MMM")} – ${formatDate(customRange.to, "d MMM yy")}`
                      : "Custom range"}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={range}
                  onSelect={setRange}
                  numberOfMonths={2}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
                <div className="flex items-center justify-between border-t border-border/40 p-2">
                  <p className="text-[11px] text-muted-foreground px-1">
                    {customRange ? "Range applied" : "Pick a start and end date"}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setRange(undefined)}
                    disabled={!range?.from}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Reset
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <BranchMultiSelect
              branches={branches as any}
              value={branchIds}
              onChange={setBranchIds}
              className="w-[150px]"
            />
            <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
              <SelectTrigger className="h-8 w-[120px] text-xs" aria-label="Chart granularity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Month wise</SelectItem>
                <SelectItem value="week">Week wise</SelectItem>
                <SelectItem value="day">Day wise</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh group totals"
              className="h-8 w-8 shrink-0"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartRows}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  onClick={(state: any) => {
                    const payload = state?.activePayload?.[0]?.payload;
                    if (payload) openDrilldown(payload);
                  }}
                  className="cursor-pointer"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/40" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    tickFormatter={compact}
                    tickLine={false}
                    axisLine={false}
                    width={42}
                    fontSize={11}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: any, name: any) => [money(Number(value)), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {compareMode ? (
                    compareBranches.map((b, i) => (
                      <Bar
                        key={b.id}
                        dataKey={`b_${b.id}`}
                        name={b.name}
                        fill={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={18}
                      />
                    ))
                  ) : (
                    <>
                      <Bar
                        dataKey="sales"
                        name="Sales"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={22}
                      />
                      <Bar
                        dataKey="expenses"
                        name="Expenses"
                        fill="hsl(var(--destructive))"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={22}
                      />
                    </>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {compareMode && (
              <div className="rounded-lg border border-border/40 overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-2 py-1.5">Branch</th>
                      <th className="text-right font-medium px-2 py-1.5">Sales</th>
                      <th className="text-right font-medium px-2 py-1.5">Expenses</th>
                      <th className="text-right font-medium px-2 py-1.5">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareTotals.map((b) => (
                      <tr key={b.id} className="border-t border-border/40">
                        <td className="px-2 py-1.5">
                          <span className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ background: b.color }}
                            />
                            <span className="truncate max-w-[160px]">{b.name}</span>
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(b.sales)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-destructive/80">
                          {money(b.expenses)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-right tabular-nums font-medium",
                            b.net < 0 && "text-destructive",
                          )}
                        >
                          {money(b.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground">Sales ({totalsSuffix})</p>
                <p className="text-sm font-semibold mt-1 tabular-nums">{money(totalSales)}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground">Expenses ({totalsSuffix})</p>
                <p className="text-sm font-semibold mt-1 tabular-nums">{money(totalExpenses)}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground">Sales less expenses</p>
                <p
                  className={cn(
                    "text-sm font-semibold mt-1 tabular-nums",
                    net < 0 ? "text-destructive" : "text-primary",
                  )}
                >
                  {money(net)}
                </p>
              </div>
            </div>

            <Collapsible open={showBreakdown} onOpenChange={setShowBreakdown}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs w-full justify-between">
                  <span className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5" /> Breakdown & formula
                  </span>
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", showBreakdown && "rotate-180")}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-3">
                <div className="rounded-lg border border-border/40 overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-2 py-1.5">{PERIOD_COLUMN[granularity]}</th>
                        <th className="text-right font-medium px-2 py-1.5">Sales</th>
                        <th className="text-right font-medium px-2 py-1.5">Expenses</th>
                        <th className="text-right font-medium px-2 py-1.5">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.key}
                          className="border-t border-border/40 cursor-pointer hover:bg-muted/40 transition-colors"
                          onClick={() => openDrilldown(r)}
                          title="View underlying transactions"
                        >
                          <td className="px-2 py-1.5">{r.label}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(r.sales)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-destructive/80">
                            {money(r.expenses)}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1.5 text-right tabular-nums font-medium",
                              r.net < 0 && "text-destructive",
                            )}
                          >
                            {money(r.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-[11px] text-muted-foreground space-y-1 leading-relaxed">
                  <p className="font-medium text-foreground">How this is calculated</p>
                  <p>
                    <span className="font-medium">Bucket sales</span> = Σ declared day-close totals
                    (daily sales summary) for {branchScopeLabel} within the selected period.
                  </p>
                  <p>
                    <span className="font-medium">Bucket expenses</span> = Σ expenses (excluding
                    deleted) whose expense date falls in the selected period, {branchScopeLabel}.
                  </p>
                  <p>
                    <span className="font-medium">Net</span> = period sales − period expenses.
                  </p>
                  <p>
                    Click any bar or row to open the underlying day-close sales and expense
                    transactions for that period.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </CardContent>

      <GroupTotalsDrilldownDialog
        target={drilldown}
        onOpenChange={(open) => !open && setDrilldown(null)}
      />
    </Card>
  );
}
