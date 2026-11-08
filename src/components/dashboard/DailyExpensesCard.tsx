import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { format, subDays, addDays, isToday, isFuture } from "date-fns";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ar, enUS } from "date-fns/locale";

export function DailyExpensesCard() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("ar") ? ar : enUS;
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const { format: formatCurrency } = useCurrency();
  const [selectedDate, setSelectedDate] = useState(subDays(new Date(), 1));

  const { data, isLoading } = useQuery({
    queryKey: ["daily-expenses-chart", restaurant?.id, branchId, format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!restaurant?.id) return { dailyData: [], total: 0, categories: [] };

      // Get last 7 days of expenses ending at selected date
      const endDate = selectedDate;
      const startDate = subDays(endDate, 6);

      let expensesQuery = supabase
        .from("expenses")
        .select("amount, expense_date, category_id, expense_categories(name, color)")
        .eq("restaurant_id", restaurant.id)
        .is("deleted_at", null)
        .gte("expense_date", format(startDate, "yyyy-MM-dd"))
        .lte("expense_date", format(endDate, "yyyy-MM-dd"));
      if (branchId) expensesQuery = expensesQuery.eq("branch_id", branchId);

      const { data: expenses, error } = await expensesQuery;

      if (error) throw error;

      // Group by date
      const dailyMap = new Map<string, number>();
      const categoryTotals = new Map<string, { name: string; color: string; total: number }>();

      // Initialize all 7 days
      for (let i = 0; i < 7; i++) {
        const day = format(subDays(endDate, 6 - i), "yyyy-MM-dd");
        dailyMap.set(day, 0);
      }

      expenses?.forEach((expense) => {
        const date = expense.expense_date;
        const amount = Number(expense.amount) || 0;
        dailyMap.set(date, (dailyMap.get(date) || 0) + amount);

        // Track categories
        const catName = (expense.expense_categories as any)?.name || "Uncategorized";
        const catColor = (expense.expense_categories as any)?.color || "hsl(var(--chart-3))";
        const existing = categoryTotals.get(catName);
        if (existing) {
          existing.total += amount;
        } else {
          categoryTotals.set(catName, { name: catName, color: catColor, total: amount });
        }
      });

      const dailyData = Array.from(dailyMap.entries()).map(([date, value]) => ({
        date,
        day: format(new Date(date), "EEE"),
        value,
        isSelected: date === format(selectedDate, "yyyy-MM-dd"),
      }));

      const total = expenses?.reduce((sum, e) => sum + (Number(e.amount) || 0), 0) || 0;
      const categories = Array.from(categoryTotals.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);

      return { dailyData, total, categories };
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

  const todayExpenses = data?.dailyData.find(
    d => d.date === format(selectedDate, "yyyy-MM-dd")
  )?.value || 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24 mb-4" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="fade-slide-in h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Receipt className="h-4 w-4" />
             {t("app.dashboard.dailyExpenses.title")}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={goToPreviousDay}
            >
               <ChevronLeft className="h-4 w-4 rtl-flip" />
            </Button>
            <span className="min-w-[72px] text-center text-xs text-muted-foreground">
               {isToday(selectedDate) ? t("app.dashboard.presets.today") : format(selectedDate, "MMM dd", { locale: dateLocale })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={goToNextDay}
              disabled={isToday(selectedDate)}
            >
               <ChevronRight className="h-4 w-4 rtl-flip" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <div className="flex items-baseline gap-2 mb-4">
          <span className="font-display text-2xl font-semibold tabular-nums text-foreground">
            {formatCurrency(todayExpenses)}
          </span>
          <span className="text-xs text-muted-foreground">
             {format(selectedDate, "EEEE", { locale: dateLocale })}
          </span>
        </div>

        {/* Bar Chart */}
        <div className="h-24 mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.dailyData || []} barCategoryGap="20%">
              <XAxis 
                dataKey="day" 
                axisLine={false} 
                tickLine={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis hide />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload?.length) {
                    return (
                      <div className="bg-popover border rounded-md shadow-md px-2 py-1 text-xs">
                        <p className="font-medium">{formatCurrency(payload[0].value as number)}</p>
                        <p className="text-muted-foreground">{payload[0].payload.date}</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {data?.dailyData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isSelected ? "hsl(var(--destructive))" : "hsl(var(--muted))"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Categories */}
        {data?.categories && data.categories.length > 0 && (
          <div className="space-y-1 pt-2 border-t">
             <p className="text-xs text-muted-foreground mb-2">{t("app.dashboard.dailyExpenses.topCategories")}</p>
            {data.categories.map((cat) => (
              <div key={cat.name} className="flex min-w-0 items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span 
                    className="w-2 h-2 rounded-full" 
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="truncate">{cat.name}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{formatCurrency(cat.total)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}