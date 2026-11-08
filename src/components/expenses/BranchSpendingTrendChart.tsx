import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, eachDayOfInterval, startOfWeek, eachWeekOfInterval } from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/hooks/useCurrency";
import { LineChart as LineChartIcon } from "lucide-react";
import type { ExpenseFiltersState } from "@/components/expenses/ExpenseFilters";
import { useTranslation } from "react-i18next";

interface BranchOption {
  id: string;
  name: string;
}

interface Props {
  restaurantId?: string;
  /** Active branch scope — null means "all branches". */
  branchId?: string | null;
  /** Same filter state driving the expenses list. */
  filters: ExpenseFiltersState;
  /** All branches available to the user (used for per-branch series). */
  branches: BranchOption[];
}

const SERIES_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--destructive))",
  "hsl(var(--accent-foreground))",
  "hsl(var(--muted-foreground))",
];

type Granularity = "day" | "week";

export function BranchSpendingTrendChart({ restaurantId, branchId = null, filters, branches }: Props) {
  const { format: formatCurrency } = useCurrency();
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<Granularity>("day");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["expenses-branch-trend", restaurantId, branchId, filters],
    enabled: !!restaurantId && !!filters.dateFrom && !!filters.dateTo,
    queryFn: async () => {
      let query = supabase
        .from("expenses")
        .select("amount, expense_date, branch_id")
        .eq("restaurant_id", restaurantId!)
        .is("deleted_at", null)
        .gte("expense_date", filters.dateFrom)
        .lte("expense_date", filters.dateTo);

      if (branchId) query = query.eq("branch_id", branchId);
      if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.amountMin) query = query.gte("amount", parseFloat(filters.amountMin));
      if (filters.amountMax) query = query.lte("amount", parseFloat(filters.amountMax));
      if (filters.search) query = query.ilike("description", `%${filters.search}%`);

      const { data, error } = await query.order("expense_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const branchNameById = useMemo(() => {
    const map: Record<string, string> = {};
    branches.forEach((b) => (map[b.id] = b.name));
    return map;
  }, [branches]);

  const { chartData, series } = useMemo(() => {
    if (!filters.dateFrom || !filters.dateTo) return { chartData: [], series: [] as { key: string; label: string }[] };
    const start = parseISO(filters.dateFrom);
    const end = parseISO(filters.dateTo);
    if (start > end) return { chartData: [], series: [] as { key: string; label: string }[] };

    const bucketKey = (dateStr: string) => {
      const d = parseISO(dateStr);
      return granularity === "day"
        ? format(d, "yyyy-MM-dd")
        : format(startOfWeek(d, { weekStartsOn: 6 }), "yyyy-MM-dd");
    };

    const buckets =
      granularity === "day"
        ? eachDayOfInterval({ start, end }).map((d) => format(d, "yyyy-MM-dd"))
        : eachWeekOfInterval({ start, end }, { weekStartsOn: 6 }).map((d) => format(d, "yyyy-MM-dd"));

    // Which branch keys appear in the data
    const activeBranchKeys = new Set<string>();
    const totals = new Map<string, Map<string, number>>();

    for (const row of rows as any[]) {
      const bk = bucketKey(row.expense_date as string);
      const branchKey = branchId ? branchId : (row.branch_id as string | null) || "unassigned";
      activeBranchKeys.add(branchKey);
      const inner = totals.get(bk) || new Map<string, number>();
      inner.set(branchKey, (inner.get(branchKey) || 0) + Number(row.amount || 0));
      totals.set(bk, inner);
    }

    const seriesList = Array.from(activeBranchKeys).map((key) => ({
      key,
      label: key === "unassigned" ? t("app.expenses.filters.unassigned") : branchNameById[key] ?? t("app.expenses.filters.branch"),
    }));
    seriesList.sort((a, b) => a.label.localeCompare(b.label));

    const data = buckets.map((bk) => {
      const inner = totals.get(bk);
      const point: Record<string, any> = {
        bucket: bk,
        label:
          granularity === "day"
            ? format(parseISO(bk), "MMM d")
            : `Wk of ${format(parseISO(bk), "MMM d")}`,
      };
      seriesList.forEach((s) => {
        point[s.key] = inner?.get(s.key) || 0;
      });
      return point;
    });

    return { chartData: data, series: seriesList };
  }, [rows, filters.dateFrom, filters.dateTo, granularity, branchId, branchNameById, t]);

  const grandTotal = useMemo(
    () => (rows as any[]).reduce((sum, r) => sum + Number(r.amount || 0), 0),
    [rows]
  );

  const scopeLabel = branchId ? branchNameById[branchId] ?? t("app.expenses.filters.branch") : t("app.expenses.filters.allBranches");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2 pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <LineChartIcon className="h-4 w-4 text-primary" />
          {t("app.expenses.charts.spendingTrend", { scope: scopeLabel })}
        </CardTitle>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {t("app.expenses.charts.total")}: <span className="font-semibold text-foreground">{formatCurrency(grandTotal)}</span>
          </span>
          <div className="flex items-center rounded-md border p-0.5">
            {(["day", "week"] as Granularity[]).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={granularity === g ? "default" : "ghost"}
                className="h-6 px-2 text-[11px] capitalize"
                onClick={() => setGranularity(g)}
              >
                {g === "day" ? t("app.expenses.charts.daily") : t("app.expenses.charts.weekly")}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-56 skeleton-shimmer rounded" />
        ) : chartData.length === 0 || series.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
            {t("app.expenses.charts.noSpending")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
                  series.find((s) => s.key === name)?.label ?? name,
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value: string) => series.find((s) => s.key === value)?.label ?? value}
              />
              {series.map((s, i) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default BranchSpendingTrendChart;