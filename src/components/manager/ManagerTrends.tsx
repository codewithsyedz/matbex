import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useSalesAnalytics } from "@/hooks/useSalesAnalytics";
import { useCurrency } from "@/hooks/useCurrency";

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="pt-6">
        <div className="text-sm font-medium">{title}</div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        <div className="mt-3 h-40">{children}</div>
      </CardContent>
    </Card>
  );
}

export function ManagerTrends({ from, to }: { from: Date; to: Date }) {
  const { format: fmt } = useCurrency();
  const { data, isLoading } = useSalesAnalytics(from, to);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-48 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!data || data.totals.orders === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No sales in this period.</p>;
  }

  const tooltip = {
    formatter: (v: number) => fmt(Number(v)),
    contentStyle: { fontSize: 12, borderRadius: 12 },
  } as const;

  const busyHours = data.byHour.filter((h) => h.orders > 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="text-[11px]">
          Peak hour: {data.totals.peakHour === null ? "—" : `${String(data.totals.peakHour).padStart(2, "0")}:00`}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          Busiest day: {data.byWeekday.find((w) => w.weekday === data.totals.peakWeekday)?.label ?? "—"}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {data.totals.days} days of data
        </Badge>
      </div>

      <ChartCard title="Revenue by hour" subtitle="When your money is made">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={busyHours} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(h) => `${String(h).padStart(2, "0")}`}
            />
            <Tooltip {...tooltip} labelFormatter={(h) => `${String(h).padStart(2, "0")}:00`} />
            <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Revenue by weekday">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.byWeekday} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip {...tooltip} />
            <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Weekly trend" subtitle="Revenue per ISO week">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.byWeek} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="week" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={16} />
            <Tooltip {...tooltip} />
            <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <div className="text-sm font-medium">Top sellers</div>
          <div className="mt-3 space-y-2">
            {data.topOverall.slice(0, 10).map((item, i) => (
              <div key={item.menu_item_id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className="truncate text-sm">{item.name}</span>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-medium tabular-nums">{fmt(item.revenue)}</div>
                  <div className="text-[11px] text-muted-foreground">{item.qty} sold</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <ChartCard title="Orders by daypart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.byDaypart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="daypart" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12 }} />
            <Bar dataKey="orders" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}