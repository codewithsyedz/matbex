import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useCurrency } from "@/hooks/useCurrency";

interface CostBreakdownChartProps {
  netSales: number;
  foodCost: number;
  laborCost: number;
  overheadCost: number;
  otherExpenses: number;
  profit: number;
}

const chartConfig = {
  sales: { label: "Net Sales", color: "hsl(var(--chart-1))" },
  food: { label: "Food Cost", color: "hsl(var(--chart-5))" },
  labor: { label: "Labor Cost", color: "hsl(var(--chart-4))" },
  overhead: { label: "Overhead", color: "hsl(var(--chart-3))" },
  other: { label: "Other", color: "hsl(var(--chart-2))" },
  profit: { label: "Profit", color: "hsl(var(--success))" },
};

export function CostBreakdownChart({
  netSales,
  foodCost,
  laborCost,
  overheadCost,
  otherExpenses,
  profit,
}: CostBreakdownChartProps) {
  const { format: formatCurrency } = useCurrency();

  // Waterfall chart data
  const waterfallData = [
    { 
      name: "Net Sales", 
      value: netSales, 
      fill: "hsl(var(--chart-1))",
      cumulative: netSales,
    },
    { 
      name: "Food Cost", 
      value: -foodCost, 
      fill: "hsl(var(--chart-5))",
      cumulative: netSales - foodCost,
    },
    { 
      name: "Labor Cost", 
      value: -laborCost, 
      fill: "hsl(var(--chart-4))",
      cumulative: netSales - foodCost - laborCost,
    },
    { 
      name: "Overhead", 
      value: -overheadCost, 
      fill: "hsl(var(--chart-3))",
      cumulative: netSales - foodCost - laborCost - overheadCost,
    },
    { 
      name: "Other", 
      value: -otherExpenses, 
      fill: "hsl(var(--chart-2))",
      cumulative: netSales - foodCost - laborCost - overheadCost - otherExpenses,
    },
    { 
      name: "Profit", 
      value: profit, 
      fill: profit >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))",
      cumulative: profit,
    },
  ];

  // Stacked breakdown data
  const stackedData = [{
    name: "Breakdown",
    food: foodCost,
    labor: laborCost,
    overhead: overheadCost,
    other: otherExpenses,
    profit: Math.max(profit, 0),
  }];

  // Cost distribution percentages
  const totalCosts = foodCost + laborCost + overheadCost + otherExpenses;
  const costDistribution = [
    { name: "Food", value: foodCost, percent: netSales > 0 ? (foodCost / netSales) * 100 : 0, color: "hsl(var(--chart-5))" },
    { name: "Labor", value: laborCost, percent: netSales > 0 ? (laborCost / netSales) * 100 : 0, color: "hsl(var(--chart-4))" },
    { name: "Overhead", value: overheadCost, percent: netSales > 0 ? (overheadCost / netSales) * 100 : 0, color: "hsl(var(--chart-3))" },
    { name: "Other", value: otherExpenses, percent: netSales > 0 ? (otherExpenses / netSales) * 100 : 0, color: "hsl(var(--chart-2))" },
    { name: "Profit", value: profit, percent: netSales > 0 ? (profit / netSales) * 100 : 0, color: profit >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Horizontal Stacked Bar */}
      <Card className="fade-slide-in">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Cost Breakdown (% of Sales)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Visual bar */}
            <div className="h-12 rounded-lg overflow-hidden flex">
              {costDistribution.map((item, index) => (
                item.percent > 0 && (
                  <div
                    key={index}
                    className="h-full flex items-center justify-center text-xs font-medium text-white transition-all hover:opacity-80"
                    style={{ 
                      width: `${Math.max(item.percent, 0)}%`, 
                      backgroundColor: item.color,
                      minWidth: item.percent > 3 ? "auto" : "0"
                    }}
                    title={`${item.name}: ${item.percent.toFixed(1)}%`}
                  >
                    {item.percent > 8 && `${item.percent.toFixed(0)}%`}
                  </div>
                )
              ))}
            </div>

            {/* Legend with values */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {costDistribution.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-sm flex-shrink-0" 
                    style={{ backgroundColor: item.color }}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.value)} ({item.percent.toFixed(1)}%)
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Waterfall Chart */}
      <Card className="fade-slide-in" style={{ animationDelay: "50ms" }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Sales to Profit Waterfall</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfallData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={true} vertical={false} />
                <XAxis type="number" className="text-xs" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" className="text-xs" width={80} />
                <ChartTooltip 
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-popover border rounded-lg p-2 shadow-lg">
                        <p className="font-medium text-sm">{data.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(Math.abs(data.value))}
                          {data.value < 0 && " (cost)"}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="cumulative" radius={[0, 4, 4, 0]}>
                  {waterfallData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
