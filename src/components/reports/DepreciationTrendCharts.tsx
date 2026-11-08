import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { DepreciationTrendPoint } from "@/hooks/useDepreciationReport";

const chartConfig = {
  netBookValue: { label: "Net book value", color: "hsl(var(--primary))" },
  periodExpense: { label: "Depreciation charge", color: "hsl(var(--chart-2))" },
  accumulated: { label: "Accumulated depreciation", color: "hsl(var(--chart-4))" },
  cost: { label: "Gross cost", color: "hsl(var(--muted-foreground))" },
} satisfies ChartConfig;

interface Props {
  data: DepreciationTrendPoint[];
  isLoading?: boolean;
  /** Currency formatter from useCurrency. */
  format: (n: number) => string;
  periodLabel: string;
  branchScopeLabel: string;
}

type View = "nbv" | "expense" | "combined";

const compact = (n: number) =>
  Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n));

export function DepreciationTrendCharts({
  data,
  isLoading,
  format,
  periodLabel,
  branchScopeLabel,
}: Props) {
  const [view, setView] = useState<View>("nbv");

  const summary = useMemo(() => {
    if (data.length === 0) return null;
    const first = data[0];
    const last = data[data.length - 1];
    const totalCharge = data.reduce((s, p) => s + p.periodExpense, 0);
    const delta = last.netBookValue - first.netBookValue;
    return { first, last, totalCharge, delta };
  }, [data]);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base font-medium">Depreciation trend · last 12 months</CardTitle>
          <CardDescription className="font-light">
            {branchScopeLabel} — net book value and the monthly charge posted through {periodLabel}.
            {summary
              ? ` ${format(summary.totalCharge)} charged over the window, NBV ${
                  summary.delta >= 0 ? "up" : "down"
                } ${format(Math.abs(summary.delta))}.`
              : ""}
          </CardDescription>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as View)} className="shrink-0">
          <TabsList>
            <TabsTrigger value="nbv">Net book value</TabsTrigger>
            <TabsTrigger value="expense">Period expense</TabsTrigger>
            <TabsTrigger value="combined">Combined</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : data.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No depreciation history to chart yet.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            {view === "nbv" ? (
              <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="nbvFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-netBookValue)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-netBookValue)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={compact} />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => format(Number(v))} />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Area
                  type="monotone"
                  dataKey="netBookValue"
                  stroke="var(--color-netBookValue)"
                  fill="url(#nbvFill)"
                  strokeWidth={2}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="accumulated"
                  stroke="var(--color-accumulated)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </AreaChart>
            ) : view === "expense" ? (
              <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={compact} />
                <ChartTooltip
                  cursor={{ fillOpacity: 0.08 }}
                  content={<ChartTooltipContent formatter={(v) => format(Number(v))} />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="periodExpense"
                  fill="var(--color-periodExpense)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            ) : (
              <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={compact} />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => format(Number(v))} />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="periodExpense"
                  fill="var(--color-periodExpense)"
                  radius={[4, 4, 0, 0]}
                  barSize={18}
                />
                <Line
                  type="monotone"
                  dataKey="netBookValue"
                  stroke="var(--color-netBookValue)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="cost"
                  stroke="var(--color-cost)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </ComposedChart>
            )}
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
