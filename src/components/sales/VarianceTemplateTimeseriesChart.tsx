import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import {
  useVarianceTemplateTimeseries,
  type Granularity,
} from "@/hooks/useVarianceTemplateTimeseries";

interface Props {
  fromISO: string;
  toISO: string;
  resolveLabel: (key: string) => { label: string; kind: "builtin" | "custom" };
  templateKeys: string[];
}

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

export function VarianceTemplateTimeseriesChart({
  fromISO,
  toISO,
  resolveLabel,
  templateKeys,
}: Props) {
  const { data, isLoading } = useVarianceTemplateTimeseries({ fromISO, toISO });
  const [selected, setSelected] = useState<string | "__all__">("__all__");

  const orderedKeys = useMemo(() => {
    const counts = data?.byTemplate ?? {};
    return [...templateKeys].sort(
      (a, b) => (counts[b]?.total ?? 0) - (counts[a]?.total ?? 0)
    );
  }, [templateKeys, data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    if (selected !== "__all__") {
      const t = data.byTemplate[selected];
      if (!t) return [];
      return t.buckets.map((b) => ({
        label: b.label,
        short: b.short,
        over: b.over,
        zero: b.zero,
        total: b.total,
      }));
    }
    // Aggregate across all templates
    const map = new Map<
      string,
      { label: string; short: number; over: number; zero: number; total: number }
    >();
    for (const t of Object.values(data.byTemplate)) {
      for (const b of t.buckets) {
        const cur = map.get(b.bucketISO) ?? {
          label: b.label,
          short: 0,
          over: 0,
          zero: 0,
          total: 0,
        };
        cur.short += b.short;
        cur.over += b.over;
        cur.zero += b.zero;
        cur.total += b.total;
        map.set(b.bucketISO, cur);
      }
    }
    return Array.from(map.values());
  }, [data, selected]);

  const summary = useMemo(() => {
    if (!data) return { total: 0, short: 0, over: 0 };
    if (selected !== "__all__") {
      const t = data.byTemplate[selected];
      return {
        total: t?.total ?? 0,
        short: t?.short ?? 0,
        over: t?.over ?? 0,
      };
    }
    return Object.values(data.byTemplate).reduce(
      (acc, t) => ({
        total: acc.total + t.total,
        short: acc.short + t.short,
        over: acc.over + t.over,
      }),
      { total: 0, short: 0, over: 0 }
    );
  }, [data, selected]);

  const granularity = data?.granularity ?? "day";
  const hasData = chartData.some((d) => d.total > 0);

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <h4 className="text-sm font-medium">Selections over time</h4>
            <Badge variant="outline" className="text-[10px]">
              {GRANULARITY_LABELS[granularity]} buckets
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
            <span className="tabular-nums">{summary.total} total</span>
            <span className="inline-flex items-center gap-1 text-rose-600">
              <TrendingDown className="h-3 w-3" /> {summary.short}
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <TrendingUp className="h-3 w-3" /> {summary.over}
            </span>
          </div>
        </div>
        <Select value={selected} onValueChange={(v) => setSelected(v)}>
          <SelectTrigger className="h-8 text-xs w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All templates (combined)</SelectItem>
            {orderedKeys.map((k) => {
              const meta = resolveLabel(k);
              const total = data?.byTemplate[k]?.total ?? 0;
              return (
                <SelectItem key={k} value={k}>
                  {meta.label} · {total}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      )}

      {!isLoading && !hasData && (
        <div className="h-56 flex items-center justify-center text-xs text-muted-foreground rounded border border-dashed">
          No selections in this window for the chosen template.
        </div>
      )}

      {!isLoading && hasData && (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                }}
                cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="short"
                stackId="counts"
                name="Short"
                fill="hsl(var(--destructive))"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="over"
                stackId="counts"
                name="Over"
                fill="hsl(var(--primary))"
                radius={[3, 3, 0, 0]}
              />
              {chartData.some((d) => d.zero > 0) && (
                <Bar
                  dataKey="zero"
                  stackId="counts"
                  name="Zero"
                  fill="hsl(var(--muted-foreground))"
                  radius={[3, 3, 0, 0]}
                />
              )}
              <Line
                type="monotone"
                dataKey="total"
                name="Total selections"
                stroke="hsl(var(--foreground))"
                strokeWidth={1.5}
                dot={{ r: 2 }}
                activeDot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
