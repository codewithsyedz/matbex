import { motion } from "framer-motion";
import { format } from "date-fns";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, CartesianGrid } from "recharts";
import { useDailyProfit } from "@/hooks/useDailyProfit";
import { useSalesAnalytics } from "@/hooks/useSalesAnalytics";
import { useCurrency } from "@/hooks/useCurrency";
import { cn } from "@/lib/utils";

function Delta({ curr, prev }: { curr: number; prev: number }) {
  if (!prev) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Minus className="h-3 w-3" />—</span>;
  const d = ((curr - prev) / Math.abs(prev)) * 100;
  const up = d >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", up ? "text-success" : "text-destructive")}>
      <Icon className="h-3 w-3" />
      {Math.abs(d).toFixed(0)}%
    </span>
  );
}

function Kpi({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="pt-6 min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-semibold tabular-nums break-words">{value}</div>
        {children}
      </CardContent>
    </Card>
  );
}

export function ManagerOverview({ from, to }: { from: Date; to: Date }) {
  const { format: fmt } = useCurrency();
  const { today, yesterday, isLoading } = useDailyProfit(new Date());
  const { data: analytics, isLoading: aLoading } = useSalesAnalytics(from, to);

  // Daily revenue series for the selected range.
  const byDay = (() => {
    const map = new Map<string, { revenue: number; orders: number }>();
    (analytics?.rows ?? []).forEach((r) => {
      const cur = map.get(r.ymd) ?? { revenue: 0, orders: 0 };
      cur.revenue += r.total;
      cur.orders += 1;
      map.set(r.ymd, cur);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ymd, v]) => ({ ymd, label: ymd.slice(5), ...v }));
  })();

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25 }}
        className="rounded-2xl border bg-gradient-to-br from-success/10 to-success/0 p-5"
      >
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Today's net profit</div>
        {isLoading ? (
          <Skeleton className="mt-2 h-9 w-40" />
        ) : (
          <div className="mt-2 flex items-baseline gap-3">
            <div className="text-3xl font-semibold tracking-tight tabular-nums">
              {fmt(today?.operatingProfit ?? 0)}
            </div>
            <Delta curr={today?.operatingProfit ?? 0} prev={yesterday?.operatingProfit ?? 0} />
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {format(new Date(), "EEEE, d MMM yyyy")} · vs yesterday
        </p>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Sales today" value={fmt(today?.netSales ?? 0)}>
          <Delta curr={today?.netSales ?? 0} prev={yesterday?.netSales ?? 0} />
        </Kpi>
        <Kpi label="Prime cost" value={`${(today?.primeCostPercentage ?? 0).toFixed(1)}%`} />
        <Kpi label="Range revenue" value={fmt(analytics?.totals.revenue ?? 0)} />
        <Kpi label="Avg ticket" value={fmt(analytics?.totals.avgTicket ?? 0)} />
        <Kpi label="Orders" value={String(analytics?.totals.orders ?? 0)} />
        <Kpi label="Orders / day" value={(analytics?.totals.avgOrdersPerDay ?? 0).toFixed(1)} />
      </div>

      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <div className="text-sm font-medium">Daily revenue trend</div>
          {aLoading ? (
            <Skeleton className="mt-3 h-44 w-full" />
          ) : byDay.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">No sales in this period.</p>
          ) : (
            <div className="mt-3 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={byDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="mgrRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={16} />
                  <Tooltip
                    formatter={(v: number) => fmt(Number(v))}
                    contentStyle={{ fontSize: 12, borderRadius: 12 }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#mgrRev)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}