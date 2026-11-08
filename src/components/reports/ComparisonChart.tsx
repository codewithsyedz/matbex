import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

interface ComparisonData {
  label: string;
  current: number;
  previous: number;
}

interface ComparisonChartProps {
  title: string;
  data: ComparisonData[];
  currentLabel: string;
  previousLabel: string;
  valueFormatter?: (value: number) => string;
}

const chartConfig = {
  current: { label: "Current", color: "hsl(var(--chart-1))" },
  previous: { label: "Previous", color: "hsl(var(--chart-2))" },
};

export function ComparisonChart({
  title,
  data,
  currentLabel,
  previousLabel,
  valueFormatter = (v) => v.toFixed(2),
}: ComparisonChartProps) {
  // Calculate totals and change percentage
  const currentTotal = data.reduce((sum, d) => sum + d.current, 0);
  const previousTotal = data.reduce((sum, d) => sum + d.previous, 0);
  const changePercent = previousTotal === 0 
    ? (currentTotal > 0 ? 100 : 0)
    : ((currentTotal - previousTotal) / previousTotal) * 100;

  const isPositive = changePercent > 0;
  const isNeutral = Math.abs(changePercent) < 0.5;

  return (
    <Card className="fade-slide-in">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <div className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium ${
                isNeutral
                  ? "bg-muted text-muted-foreground"
                  : isPositive
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {isNeutral ? (
                <Minus className="h-3 w-3" />
              ) : isPositive ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {Math.abs(changePercent).toFixed(1)}%
            </div>
          </div>
        </div>
        <div className="flex gap-6 text-sm mt-2">
          <div>
            <span className="text-muted-foreground">{currentLabel}: </span>
            <span className="font-semibold">{valueFormatter(currentTotal)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{previousLabel}: </span>
            <span className="font-semibold">{valueFormatter(previousTotal)}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <BarChart data={data} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis 
                dataKey="label" 
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 11 }}
              />
              <YAxis className="text-xs fill-muted-foreground" />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => {
                      const label = name === "current" ? currentLabel : previousLabel;
                      return [`${valueFormatter(value as number)}`, label];
                    }}
                  />
                }
              />
              <Legend
                formatter={(value) => (value === "current" ? currentLabel : previousLabel)}
              />
              <Bar
                dataKey="current"
                name="current"
                fill="hsl(var(--chart-1))"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="previous"
                name="previous"
                fill="hsl(var(--chart-2))"
                radius={[4, 4, 0, 0]}
                opacity={0.6}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="h-[280px] flex items-center justify-center text-muted-foreground">
            No data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
