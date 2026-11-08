import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { Download, TrendingUp, TrendingDown, Minus, FileText } from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, eachWeekOfInterval, subWeeks, subMonths } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { DailyProfitState } from "@/hooks/useDailyProfit";
import { useProfitForecast } from "@/hooks/useProfitForecast";
import { exportToPDF } from "@/lib/exportUtils";
import { toast } from "sonner";

interface ProfitSummaryReportProps {
  dailyData: DailyProfitState[];
  period: "weekly" | "monthly";
}

const chartConfig = {
  profit: { label: "Profit", color: "hsl(var(--success))" },
  sales: { label: "Sales", color: "hsl(var(--chart-1))" },
  costs: { label: "Costs", color: "hsl(var(--chart-5))" },
  forecast: { label: "Forecast", color: "hsl(var(--primary))" },
};

export function ProfitSummaryReport({ dailyData, period }: ProfitSummaryReportProps) {
  const { format: formatCurrency } = useCurrency();
  const forecast = useProfitForecast(dailyData, 7);

  // Aggregate data by period
  const aggregatedData = useMemo(() => {
    if (!dailyData || dailyData.length === 0) return [];

    if (period === "weekly") {
      const weeks = eachWeekOfInterval({
        start: subWeeks(new Date(), 8),
        end: new Date(),
      });

      return weeks.map((weekStart) => {
        const weekEnd = endOfWeek(weekStart);
        const weekData = dailyData.filter((d) => {
          const date = new Date(d.date);
          return date >= weekStart && date <= weekEnd;
        });

        const totalProfit = weekData.reduce((sum, d) => sum + d.operatingProfit, 0);
        const totalSales = weekData.reduce((sum, d) => sum + d.netSales, 0);
        const totalCosts = weekData.reduce(
          (sum, d) => sum + d.primeCost + d.otherExpenses + d.allocatedOverhead,
          0
        );
        const avgMargin = weekData.length > 0
          ? weekData.reduce((sum, d) => sum + d.operatingMarginPercentage, 0) / weekData.length
          : 0;

        return {
          label: format(weekStart, "MMM d"),
          weekStart: format(weekStart, "yyyy-MM-dd"),
          weekEnd: format(weekEnd, "yyyy-MM-dd"),
          profit: totalProfit,
          sales: totalSales,
          costs: totalCosts,
          margin: avgMargin,
          days: weekData.length,
        };
      });
    } else {
      // Monthly aggregation
      const months: { [key: string]: DailyProfitState[] } = {};
      
      dailyData.forEach((d) => {
        const monthKey = format(new Date(d.date), "yyyy-MM");
        if (!months[monthKey]) months[monthKey] = [];
        months[monthKey].push(d);
      });

      return Object.entries(months)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6)
        .map(([monthKey, data]) => {
          const totalProfit = data.reduce((sum, d) => sum + d.operatingProfit, 0);
          const totalSales = data.reduce((sum, d) => sum + d.netSales, 0);
          const totalCosts = data.reduce(
            (sum, d) => sum + d.primeCost + d.otherExpenses + d.allocatedOverhead,
            0
          );
          const avgMargin = data.length > 0
            ? data.reduce((sum, d) => sum + d.operatingMarginPercentage, 0) / data.length
            : 0;

          return {
            label: format(new Date(monthKey + "-01"), "MMM yyyy"),
            monthKey,
            profit: totalProfit,
            sales: totalSales,
            costs: totalCosts,
            margin: avgMargin,
            days: data.length,
          };
        });
    }
  }, [dailyData, period]);

  // Calculate summary stats
  const summary = useMemo(() => {
    if (aggregatedData.length === 0) return null;

    const current = aggregatedData[aggregatedData.length - 1];
    const previous = aggregatedData[aggregatedData.length - 2];

    const profitChange = previous && previous.profit !== 0
      ? ((current.profit - previous.profit) / Math.abs(previous.profit)) * 100
      : 0;

    const totalProfit = aggregatedData.reduce((sum, d) => sum + d.profit, 0);
    const totalSales = aggregatedData.reduce((sum, d) => sum + d.sales, 0);
    const avgMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

    return {
      currentProfit: current?.profit || 0,
      currentSales: current?.sales || 0,
      currentMargin: current?.margin || 0,
      profitChange,
      totalProfit,
      totalSales,
      avgMargin,
    };
  }, [aggregatedData]);

  // Export to PDF
  const handleExport = () => {
    const headers = [
      period === "weekly" ? "Week" : "Month",
      "Sales",
      "Costs",
      "Profit",
      "Margin %",
    ];
    const rows = aggregatedData.map((d) => [
      d.label,
      d.sales.toFixed(2),
      d.costs.toFixed(2),
      d.profit.toFixed(2),
      d.margin.toFixed(1) + "%",
    ]);

    // Add summary row
    if (summary) {
      rows.push([
        "Total",
        summary.totalSales.toFixed(2),
        (summary.totalSales - summary.totalProfit).toFixed(2),
        summary.totalProfit.toFixed(2),
        summary.avgMargin.toFixed(1) + "%",
      ]);
    }

    exportToPDF({
      headers,
      rows,
      filename: `Profit_Report_${period}_${format(new Date(), "yyyy-MM-dd")}`,
    });
    toast.success(`${period === "weekly" ? "Weekly" : "Monthly"} profit report exported`);
  };

  const TrendIcon = forecast.trend === "up" 
    ? TrendingUp 
    : forecast.trend === "down" 
    ? TrendingDown 
    : Minus;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-muted-foreground">
              Current {period === "weekly" ? "Week" : "Month"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCurrency(summary?.currentProfit || 0)}
            </p>
            {summary && summary.profitChange !== 0 && (
              <div className="flex items-center gap-1 mt-1">
                <TrendIcon className={`h-4 w-4 ${
                  summary.profitChange > 0 ? "text-success" : "text-destructive"
                }`} />
                <span className={`text-sm ${
                  summary.profitChange > 0 ? "text-success" : "text-destructive"
                }`}>
                  {summary.profitChange > 0 ? "+" : ""}{summary.profitChange.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground">vs previous</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-muted-foreground">
              Total Sales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCurrency(summary?.totalSales || 0)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {aggregatedData.length} {period === "weekly" ? "weeks" : "months"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-muted-foreground">
              Average Margin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {(summary?.avgMargin || 0).toFixed(1)}%
            </p>
            <Badge 
              variant={
                (summary?.avgMargin || 0) >= 15 
                  ? "default" 
                  : (summary?.avgMargin || 0) >= 10 
                  ? "secondary" 
                  : "destructive"
              }
              className="mt-1"
            >
              {(summary?.avgMargin || 0) >= 15 ? "Healthy" : (summary?.avgMargin || 0) >= 10 ? "Fair" : "Low"}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-muted-foreground">
              Trend & Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendIcon className={`h-5 w-5 ${
                forecast.trend === "up" ? "text-success" : 
                forecast.trend === "down" ? "text-destructive" : 
                "text-muted-foreground"
              }`} />
              <span className="text-lg font-semibold capitalize">{forecast.trend}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {forecast.confidence.toFixed(0)}% confidence
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profit Trend Chart */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-medium">Profit Trend</CardTitle>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <FileText className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={aggregatedData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" className="text-xs" />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    stroke="hsl(var(--success))"
                    fill="hsl(var(--success) / 0.2)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Sales vs Costs Chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Sales vs Costs</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aggregatedData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" className="text-xs" />
                  <YAxis className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="sales" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="costs" fill="hsl(var(--chart-5))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Forecast Chart */}
      {forecast.forecasts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              7-Day Profit Forecast
              <Badge variant="secondary" className="font-normal">
                {forecast.confidence.toFixed(0)}% confidence
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={forecast.forecasts}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs"
                    tickFormatter={(val) => format(new Date(val), "MMM d")}
                  />
                  <YAxis className="text-xs" />
                  <ChartTooltip 
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="bg-popover border rounded-lg p-3 shadow-lg">
                          <p className="font-medium">{format(new Date(data.date), "MMM d, yyyy")}</p>
                          {data.isHistorical ? (
                            <p className="text-sm text-muted-foreground">
                              Actual: {formatCurrency(data.actual)}
                            </p>
                          ) : (
                            <>
                              <p className="text-sm text-primary">
                                Predicted: {formatCurrency(data.predicted)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Range: {formatCurrency(data.lower)} - {formatCurrency(data.upper)}
                              </p>
                            </>
                          )}
                        </div>
                      );
                    }}
                  />
                  {/* Confidence interval area */}
                  <Area
                    type="monotone"
                    dataKey="upper"
                    stroke="transparent"
                    fill="hsl(var(--primary) / 0.1)"
                  />
                  <Area
                    type="monotone"
                    dataKey="lower"
                    stroke="transparent"
                    fill="hsl(var(--background))"
                  />
                  {/* Actual values */}
                  <Area
                    type="monotone"
                    dataKey="actual"
                    stroke="hsl(var(--success))"
                    fill="hsl(var(--success) / 0.2)"
                    strokeWidth={2}
                    connectNulls={false}
                  />
                  {/* Predicted line */}
                  <Area
                    type="monotone"
                    dataKey="predicted"
                    stroke="hsl(var(--primary))"
                    fill="transparent"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
            <div className="flex items-center justify-center gap-6 mt-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-0.5 bg-success" />
                <span className="text-muted-foreground">Actual</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-0.5 bg-primary border-dashed" style={{ borderTop: "2px dashed hsl(var(--primary))" }} />
                <span className="text-muted-foreground">Forecast</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-primary/10 rounded" />
                <span className="text-muted-foreground">Confidence Range</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Projected Values */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-muted-foreground">
              Projected Weekly Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCurrency(forecast.projectedWeekly)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Based on {forecast.confidence.toFixed(0)}% confidence trend
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-muted-foreground">
              Projected Monthly Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCurrency(forecast.projectedMonthly)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Extrapolated from current trend
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
