import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, eachDayOfInterval, parseISO } from "date-fns";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BranchTotalsExplainerTooltip } from "@/components/branches/BranchTotalsExplainer";
import { useCurrency } from "@/hooks/useCurrency";
import { BarChart3 } from "lucide-react";
import { useReconciledSales } from "@/lib/reconciledSales";
import { useTranslation } from "react-i18next";

interface Props {
  restaurantId?: string;
  dateFrom: string;
  dateTo: string;
  /** Optional branch scope. */
  branchId?: string | null;
}

export function DailyExpenseBarChart({ restaurantId, dateFrom, dateTo, branchId = null }: Props) {
  const { format: formatCurrency } = useCurrency();
  const { t } = useTranslation();

  const { data: expenseRows = [], isLoading: isLoadingExpenses } = useQuery({
    queryKey: ["expenses-daily", restaurantId, dateFrom, dateTo, branchId],
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
    const salesTotals = reconciled?.perDay ?? new Map<string, number>();
    return eachDayOfInterval({ start, end }).map((d) => {
      const key = format(d, "yyyy-MM-dd");
      return {
        date: key,
        label: format(d, "MMM d"),
        expenses: expenseTotals.get(key) || 0,
        sales: salesTotals.get(key) || 0,
      };
    });
  }, [expenseRows, reconciled, dateFrom, dateTo]);

  const totalExpenses = chartData.reduce((sum, d) => sum + d.expenses, 0);
  const totalSales = chartData.reduce((sum, d) => sum + d.sales, 0);
  const isLoading = isLoadingExpenses || isLoadingSales;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2 pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          {t("app.expenses.charts.dailyTitle")}
          <BranchTotalsExplainerTooltip />
        </CardTitle>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {t("app.expenses.summary.expenses")}: <span className="font-semibold text-foreground">{formatCurrency(totalExpenses)}</span>
          </span>
          <span className="text-muted-foreground">
            {t("app.expenses.summary.sales")}: <span className="font-semibold" style={{ color: "hsl(var(--success))" }}>{formatCurrency(totalSales)}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-56 skeleton-shimmer rounded" />
        ) : chartData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
            {t("app.expenses.charts.selectRange")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
                  name === "expenses" ? t("app.expenses.summary.expenses") : t("app.expenses.summary.sales"),
                ]}
                labelFormatter={(l) => l}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value: string) => (value === "expenses" ? t("app.expenses.summary.expenses") : t("app.expenses.summary.sales"))}
              />
              <Bar
                dataKey="expenses"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Bar
                dataKey="sales"
                fill="hsl(var(--success))"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default DailyExpenseBarChart;
