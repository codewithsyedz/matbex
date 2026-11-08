import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Download, TrendingUp, Clock, Sun, Moon, Activity, Trophy, Search, ArrowUp, ArrowDown, Minus, GitCompare } from "lucide-react";
import { subDays, startOfDay, endOfDay, format } from "date-fns";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, Legend, Cell, AreaChart, Area,
} from "recharts";
import { useSalesAnalytics, formatHourLabel, rangeLabel, WEEKDAY_LABELS_EXPORT } from "@/hooks/useSalesAnalytics";
import { useDaypartSettings, formatHour12, type DayPart } from "@/hooks/useDaypartSettings";
import { useCurrency } from "@/hooks/useCurrency";
import { useTranslation } from "react-i18next";

type RangeKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "365d";

function getRange(key: RangeKey): { from: Date; to: Date } {
  const to = endOfDay(new Date());
  if (key === "today") return { from: startOfDay(new Date()), to };
  if (key === "yesterday") {
    const y = subDays(startOfDay(new Date()), 1);
    return { from: y, to: endOfDay(y) };
  }
  const map: Record<Exclude<RangeKey, "today" | "yesterday">, number> = { "7d": 6, "30d": 29, "90d": 89, "365d": 364 };
  return { from: startOfDay(subDays(to, map[key as Exclude<RangeKey, "today" | "yesterday">])), to };
}

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function SalesAnalytics() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const { from, to } = useMemo(() => getRange(rangeKey), [rangeKey]);
  const { data, isLoading } = useSalesAnalytics(from, to);
  const { format: fmtMoney } = useCurrency();
  const { config: dp } = useDaypartSettings();
  const { t } = useTranslation();

  const [daypartFilter, setDaypartFilter] = useState<DayPart>("Morning");

  const daypartHourRange = useMemo(() => {
    if (daypartFilter === "Morning") return [dp.morning_start, dp.noon_start - 1];
    if (daypartFilter === "Noon") return [dp.noon_start, dp.evening_start - 1];
    if (daypartFilter === "Evening") return [dp.evening_start, dp.late_night_start - 1];
    return [dp.late_night_start, (dp.morning_start - 1 + 24) % 24];
  }, [daypartFilter, dp]);

  const filteredDaypartHours = useMemo(() => {
    if (!data) return [];
    const [start, end] = daypartHourRange;
    if (start <= end) return data.byHour.filter((h) => h.hour >= start && h.hour <= end);
    // Late Night wraps past midnight
    return data.byHour.filter((h) => h.hour >= start || h.hour <= end);
  }, [data, daypartHourRange]);

  type DrillFilter =
    | { kind: "hour"; value: number }
    | { kind: "daypart"; value: string; metric?: "orders" | "revenue" }
    | { kind: "weekday"; value: number }
    | { kind: "week"; value: string }
    | { kind: "month"; value: string };
  const [drill, setDrill] = useState<DrillFilter | null>(null);

  const drillResult = useMemo(() => {
    if (!data || !drill) return null;
    const matchedRows = data.rows.filter((r) => {
      if (drill.kind === "hour") return r.hour === drill.value;
      if (drill.kind === "daypart") return r.daypart === drill.value;
      if (drill.kind === "weekday") return r.weekday === drill.value;
      if (drill.kind === "week") return r.isoWeek === drill.value;
      if (drill.kind === "month") return r.yearMonth === drill.value;
      return false;
    });
    const txIds = new Set(matchedRows.map((r) => r.id));
    const matchedItems = data.items.filter((i) => txIds.has(i.transaction_id));
    const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
    matchedItems.forEach((it) => {
      const cur = itemMap.get(it.menu_item_id) ?? {
        name: data.itemNameById[it.menu_item_id] ?? "Unknown",
        qty: 0,
        revenue: 0,
      };
      cur.qty += Number(it.quantity) || 0;
      cur.revenue += Number(it.total_price) || 0;
      itemMap.set(it.menu_item_id, cur);
    });
    const items = Array.from(itemMap.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => {
        if (drill.kind === "daypart" && drill.metric === "revenue") {
          return b.revenue - a.revenue;
        }
        return b.qty - a.qty;
      });
    const orders = matchedRows.length;
    const revenue = matchedRows.reduce((s, r) => s + r.total, 0);

    // Payment method breakdown (all drill kinds, but primarily for daypart)
    const paymentMap = new Map<string, { orders: number; revenue: number }>();
    matchedRows.forEach((r) => {
      const pm = r.payment_method || "other";
      const cur = paymentMap.get(pm) ?? { orders: 0, revenue: 0 };
      cur.orders++; cur.revenue += r.total;
      paymentMap.set(pm, cur);
    });
    const paymentBreakdown = Array.from(paymentMap.entries())
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      rows: matchedRows.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      items,
      orders,
      revenue,
      avgTicket: orders ? revenue / orders : 0,
      paymentBreakdown,
    };
  }, [data, drill]);

  const drillTitle = (() => {
    if (!drill) return "";
    if (drill.kind === "hour") return `Hour · ${formatHourLabel(drill.value as number)}`;
    if (drill.kind === "daypart") {
      const suffix = drill.metric === "revenue" ? " · Revenue View" : "";
      return `Daypart · ${drill.value}${suffix}`;
    }
    if (drill.kind === "weekday") return `Weekday · ${WEEKDAY_LABELS_EXPORT[drill.value as number]}`;
    if (drill.kind === "week") return `Week · ${drill.value}`;
    return `Month · ${drill.value}`;
  })();

  const handleExport = () => {
    if (!data) return;
    const rows: (string | number)[][] = [];
    rows.push([`Sales Analytics - ${rangeLabel(from, to)}`]);
    rows.push([]);
    rows.push(["Summary"]);
    rows.push(["Total Orders", data.totals.orders]);
    rows.push(["Total Revenue", data.totals.revenue.toFixed(2)]);
    rows.push(["Avg Ticket", data.totals.avgTicket.toFixed(2)]);
    rows.push(["Avg Orders / Day", data.totals.avgOrdersPerDay.toFixed(2)]);
    rows.push(["Avg Orders / Operating Hour", data.totals.avgOrdersPerHour.toFixed(2)]);
    rows.push(["Peak Hour", data.totals.peakHour !== null ? formatHourLabel(data.totals.peakHour) : "-"]);
    rows.push(["Peak Weekday", data.totals.peakWeekday !== null ? WEEKDAY_LABELS_EXPORT[data.totals.peakWeekday] : "-"]);
    rows.push([]);
    rows.push(["By Hour"]);
    rows.push(["Hour", "Orders", "Revenue"]);
    data.byHour.forEach((b) => rows.push([formatHourLabel(b.hour), b.orders, b.revenue.toFixed(2)]));
    rows.push([]);
    rows.push(["By Daypart"]);
    rows.push(["Daypart", "Orders", "Revenue"]);
    data.byDaypart.forEach((b) => rows.push([b.daypart, b.orders, b.revenue.toFixed(2)]));
    rows.push([]);
    rows.push(["By Weekday"]);
    rows.push(["Weekday", "Orders", "Revenue"]);
    data.byWeekday.forEach((b) => rows.push([b.label, b.orders, b.revenue.toFixed(2)]));
    rows.push([]);
    rows.push(["By Week"]);
    rows.push(["Week", "Orders", "Revenue"]);
    data.byWeek.forEach((b) => rows.push([b.week, b.orders, b.revenue.toFixed(2)]));
    rows.push([]);
    rows.push(["By Month"]);
    rows.push(["Month", "Orders", "Revenue"]);
    data.byMonth.forEach((b) => rows.push([b.month, b.orders, b.revenue.toFixed(2)]));
    rows.push([]);
    rows.push(["Top Sellers (Overall)"]);
    rows.push(["Item", "Qty", "Revenue"]);
    data.topOverall.forEach((t) => rows.push([t.name, t.qty, t.revenue.toFixed(2)]));
    rows.push([]);
    rows.push(["Top Seller per Hour"]);
    rows.push(["Hour", "Top Item", "Qty", "Revenue"]);
    Object.entries(data.topByHour).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([h, list]) => {
      const top = list[0];
      if (top) rows.push([formatHourLabel(Number(h)), top.name, top.qty, top.revenue.toFixed(2)]);
    });
    rows.push([]);
    rows.push(["Top Seller per Week"]);
    rows.push(["Week", "Top Item", "Qty", "Revenue"]);
    Object.entries(data.topByWeek).sort((a, b) => a[0].localeCompare(b[0])).forEach(([w, list]) => {
      const top = list[0];
      if (top) rows.push([w, top.name, top.qty, top.revenue.toFixed(2)]);
    });
    downloadCSV(`sales-analytics-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}.csv`, rows);
  };

  const handleExportDaypartCSV = () => {
    if (!data) return;
    const totalRev = data.byDaypart.reduce((s, b) => s + b.revenue, 0);
    const rows: (string | number)[][] = [];
    rows.push([`Daypart Revenue Report - ${rangeLabel(from, to)}`]);
    rows.push([]);
    rows.push(["Configured Ranges"]);
    rows.push(["Morning", `${formatHour12(dp.morning_start)}–${formatHour12(dp.noon_start - 1)}`]);
    rows.push(["Noon", `${formatHour12(dp.noon_start)}–${formatHour12(dp.evening_start - 1)}`]);
    rows.push(["Evening", `${formatHour12(dp.evening_start)}–${formatHour12(dp.late_night_start - 1)}`]);
    rows.push(["Late Night", `${formatHour12(dp.late_night_start)}–${formatHour12((dp.morning_start - 1 + 24) % 24)}`]);
    rows.push([]);
    rows.push(["Daypart", "Orders", "Revenue", "Avg Ticket", "Share %"]);
    data.byDaypart.forEach((b) => {
      const share = totalRev ? (b.revenue / totalRev) * 100 : 0;
      const avg = b.orders ? b.revenue / b.orders : 0;
      rows.push([b.daypart, b.orders, b.revenue.toFixed(2), avg.toFixed(2), `${share.toFixed(1)}%`]);
    });
    rows.push(["TOTAL", data.totals.orders, totalRev.toFixed(2), data.totals.avgTicket.toFixed(2), "100.0%"]);
    downloadCSV(`daypart-revenue-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}.csv`, rows);
  };

  const handleExportDaypartPDF = async () => {
    if (!data) return;
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 56;

    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("Daypart Revenue Report", 40, y); y += 22;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.setTextColor(110); doc.text(rangeLabel(from, to), 40, y); y += 14;
    // Restaurant name omitted (not required for this report)
    doc.setTextColor(0);
    y += 8;

    // Configured ranges
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Configured Daypart Ranges", 40, y); y += 16;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const ranges = [
      ["Morning", `${formatHour12(dp.morning_start)}–${formatHour12(dp.noon_start - 1)}`],
      ["Noon", `${formatHour12(dp.noon_start)}–${formatHour12(dp.evening_start - 1)}`],
      ["Evening", `${formatHour12(dp.evening_start)}–${formatHour12(dp.late_night_start - 1)}`],
      ["Late Night", `${formatHour12(dp.late_night_start)}–${formatHour12((dp.morning_start - 1 + 24) % 24)}`],
    ];
    ranges.forEach(([k, v]) => { doc.text(`${k}: ${v}`, 60, y); y += 14; });
    y += 12;

    // Table
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Revenue Breakdown", 40, y); y += 16;
    doc.setFontSize(10);
    const cols = [
      { x: 40,  label: "Daypart", align: "left" as const },
      { x: 180, label: "Orders", align: "right" as const },
      { x: 280, label: "Revenue", align: "right" as const },
      { x: 400, label: "Avg Ticket", align: "right" as const },
      { x: pageW - 40, label: "Share %", align: "right" as const },
    ];
    cols.forEach((c) => doc.text(c.label, c.x, y, { align: c.align }));
    y += 6;
    doc.setLineWidth(0.5); doc.line(40, y, pageW - 40, y); y += 14;
    doc.setFont("helvetica", "normal");

    const totalRev = data.byDaypart.reduce((s, b) => s + b.revenue, 0);
    data.byDaypart.forEach((b) => {
      const share = totalRev ? (b.revenue / totalRev) * 100 : 0;
      const avg = b.orders ? b.revenue / b.orders : 0;
      doc.text(b.daypart, cols[0].x, y);
      doc.text(String(b.orders), cols[1].x, y, { align: "right" });
      doc.text(fmtMoney(b.revenue), cols[2].x, y, { align: "right" });
      doc.text(fmtMoney(avg), cols[3].x, y, { align: "right" });
      doc.text(`${share.toFixed(1)}%`, cols[4].x, y, { align: "right" });
      y += 16;
    });
    doc.line(40, y, pageW - 40, y); y += 14;
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL", cols[0].x, y);
    doc.text(String(data.totals.orders), cols[1].x, y, { align: "right" });
    doc.text(fmtMoney(totalRev), cols[2].x, y, { align: "right" });
    doc.text(fmtMoney(data.totals.avgTicket), cols[3].x, y, { align: "right" });
    doc.text("100.0%", cols[4].x, y, { align: "right" });
    y += 24;

    // Footer
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(`Generated ${format(new Date(), "PPpp")}`, 40, doc.internal.pageSize.getHeight() - 30);

    doc.save(`daypart-revenue-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}.pdf`);
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-primary" />
              {t("app.salesAnalytics.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("app.salesAnalytics.subtitle")} · {rangeLabel(from, to)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={rangeKey} onValueChange={(v) => setRangeKey(v as RangeKey)}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">{t("app.salesAnalytics.ranges.today")}</SelectItem>
                <SelectItem value="yesterday">{t("app.salesAnalytics.ranges.yesterday")}</SelectItem>
                <SelectItem value="7d">{t("app.salesAnalytics.ranges.last7")}</SelectItem>
                <SelectItem value="30d">{t("app.salesAnalytics.ranges.last30")}</SelectItem>
                <SelectItem value="90d">{t("app.salesAnalytics.ranges.last90")}</SelectItem>
                <SelectItem value="365d">{t("app.salesAnalytics.ranges.last365")}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!data}>
              <Download className="h-4 w-4 me-1" /> {t("app.salesAnalytics.exportCsv")}
            </Button>
          </div>
        </div>

        {isLoading || !data ? (
          <Card><CardContent className="pt-6 text-center text-muted-foreground">{t("app.salesAnalytics.loading")}</CardContent></Card>
        ) : data.totals.orders === 0 ? (
          <Card><CardContent className="pt-6 text-center text-muted-foreground">{t("app.salesAnalytics.noSales")}</CardContent></Card>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={<Activity className="h-4 w-4" />} label={t("app.salesAnalytics.kpi.totalOrders")} value={data.totals.orders.toLocaleString()} hint={t("app.salesAnalytics.kpi.days", { count: data.totals.days })} />
              <KpiCard icon={<TrendingUp className="h-4 w-4" />} label={t("app.salesAnalytics.kpi.totalRevenue")} value={fmtMoney(data.totals.revenue)} hint={t("app.salesAnalytics.kpi.avgTicket", { value: fmtMoney(data.totals.avgTicket) })} />
              <KpiCard icon={<Sun className="h-4 w-4" />} label={t("app.salesAnalytics.kpi.avgPerDay")} value={data.totals.avgOrdersPerDay.toFixed(1)} hint={t("app.salesAnalytics.kpi.perHour", { value: data.totals.avgOrdersPerHour.toFixed(1) })} />
              <KpiCard icon={<Clock className="h-4 w-4" />} label={t("app.salesAnalytics.kpi.peakHour")} value={data.totals.peakHour !== null ? formatHourLabel(data.totals.peakHour) : "-"} hint={t("app.salesAnalytics.kpi.ordersDay", { orders: data.totals.peakHourOrders, day: data.totals.peakWeekday !== null ? WEEKDAY_LABELS_EXPORT[data.totals.peakWeekday] : "-" })} />
            </div>

            <Tabs defaultValue="hourly" className="w-full">
              <TabsList className="grid grid-cols-2 md:grid-cols-6 w-full md:w-auto">
                <TabsTrigger value="hourly">{t("app.salesAnalytics.tabs.hourly")}</TabsTrigger>
                <TabsTrigger value="daypart">{t("app.salesAnalytics.tabs.daypart")}</TabsTrigger>
                <TabsTrigger value="weekly">{t("app.salesAnalytics.tabs.weekly")}</TabsTrigger>
                <TabsTrigger value="monthly">{t("app.salesAnalytics.tabs.monthly")}</TabsTrigger>
                <TabsTrigger value="compare">{t("app.salesAnalytics.tabs.compare")}</TabsTrigger>
                <TabsTrigger value="top">{t("app.salesAnalytics.tabs.top")}</TabsTrigger>
              </TabsList>

              <TabsContent value="hourly" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">{t("app.salesAnalytics.charts.ordersByHour")}</CardTitle>
                    <CardDescription>{t("app.salesAnalytics.charts.ordersByHourDesc")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[320px] w-full">
                      <ResponsiveContainer>
                        <BarChart data={data.byHour}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="hour" tickFormatter={(h) => formatHourLabel(h)} fontSize={11} />
                          <YAxis yAxisId="left" fontSize={11} />
                          <YAxis yAxisId="right" orientation="right" fontSize={11} />
                          <Tooltip
                            labelFormatter={(h) => `Hour ${formatHourLabel(Number(h))}`}
                            formatter={(value: any, name) => [value, name === "orders" ? "Orders" : "Revenue"]}
                          />
                          <Legend />
                          <Bar
                            yAxisId="left"
                            dataKey="orders"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                            onClick={(d: any) => d?.hour !== undefined && setDrill({ kind: "hour", value: d.hour })}
                          >
                            {data.byHour.map((b, i) => (
                              <Cell key={i} fill={b.hour === data.totals.peakHour ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.4)"} />
                            ))}
                          </Bar>
                          <Bar
                            yAxisId="right"
                            dataKey="revenue"
                            fill="hsl(var(--muted-foreground))"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                            onClick={(d: any) => d?.hour !== undefined && setDrill({ kind: "hour", value: d.hour })}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium flex items-center gap-2"><Trophy className="h-4 w-4" /> {t("app.salesAnalytics.hourlyTopSeller")}</CardTitle>
                    <CardDescription>{t("app.salesAnalytics.hourlyTopSellerDescription")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>{t("app.salesAnalytics.tables.hour")}</TableHead><TableHead>{t("app.salesAnalytics.tables.topItem")}</TableHead><TableHead className="text-end">{t("app.salesAnalytics.tables.qty")}</TableHead><TableHead className="text-end">{t("app.salesAnalytics.tables.revenue")}</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(data.topByHour).sort((a, b) => Number(a[0]) - Number(b[0])).map(([h, list]) => {
                            const t = list[0]; if (!t) return null;
                            return (
                              <TableRow key={h}>
                                <TableCell className="font-mono">{formatHourLabel(Number(h))}</TableCell>
                                <TableCell>{t.name}</TableCell>
                                <TableCell className="text-end">{t.qty}</TableCell>
                                <TableCell className="text-end">{fmtMoney(t.revenue)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="daypart" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base font-medium">Morning · Noon · Evening · Late Night</CardTitle>
                      <CardDescription>
                        Morning {formatHour12(dp.morning_start)}–{formatHour12(dp.noon_start - 1)} · Noon {formatHour12(dp.noon_start)}–{formatHour12(dp.evening_start - 1)} · Evening {formatHour12(dp.evening_start)}–{formatHour12(dp.late_night_start - 1)} · Late Night {formatHour12(dp.late_night_start)}–{formatHour12((dp.morning_start - 1 + 24) % 24)} · Configure in Settings → Business
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={handleExportDaypartCSV}>
                        <Download className="h-4 w-4 me-1" /> CSV
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleExportDaypartPDF}>
                        <Download className="h-4 w-4 me-1" /> PDF
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[280px] w-full">
                      <ResponsiveContainer>
                        <BarChart data={data.byDaypart}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="daypart" fontSize={12} />
                          <YAxis yAxisId="left" fontSize={11} />
                          <YAxis yAxisId="right" orientation="right" fontSize={11} />
                          <Tooltip />
                          <Legend />
                          <Bar
                            yAxisId="left"
                            dataKey="orders"
                            fill="hsl(var(--primary))"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                            onClick={(d: any) => d?.daypart && setDrill({ kind: "daypart", value: d.daypart, metric: "orders" })}
                          />
                          <Bar
                            yAxisId="right"
                            dataKey="revenue"
                            fill="hsl(var(--muted-foreground))"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                            onClick={(d: any) => d?.daypart && setDrill({ kind: "daypart", value: d.daypart, metric: "revenue" })}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3">
                    <div>
                      <CardTitle className="text-base font-medium">{t("app.salesAnalytics.charts.revenueRamp")}</CardTitle>
                      <CardDescription>Hourly revenue within the selected daypart.</CardDescription>
                    </div>
                    <Select value={daypartFilter} onValueChange={(v) => setDaypartFilter(v as DayPart)}>
                      <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Morning">{t("app.salesAnalytics.dayparts.morning")}</SelectItem>
                        <SelectItem value="Noon">{t("app.salesAnalytics.dayparts.noon")}</SelectItem>
                        <SelectItem value="Evening">{t("app.salesAnalytics.dayparts.evening")}</SelectItem>
                        <SelectItem value="Late Night">{t("app.salesAnalytics.dayparts.lateNight")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[260px] w-full">
                      {filteredDaypartHours.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                          No data for this daypart in the selected range.
                        </div>
                      ) : (
                        <ResponsiveContainer>
                          <AreaChart data={filteredDaypartHours}>
                            <defs>
                              <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis dataKey="hour" tickFormatter={(h) => formatHourLabel(h)} fontSize={11} />
                            <YAxis fontSize={11} tickFormatter={(v) => fmtMoney(Number(v))} width={70} />
                            <Tooltip
                              labelFormatter={(h) => `Hour ${formatHourLabel(Number(h))}`}
                              formatter={(value: any) => [fmtMoney(Number(value)), "Revenue"]}
                            />
                            <Area
                              type="monotone"
                              dataKey="revenue"
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              fill="url(#revGradient)"
                              cursor="pointer"
                              onClick={(d: any) => d?.hour !== undefined && setDrill({ kind: "hour", value: d.hour })}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">{t("app.salesAnalytics.charts.dayOfWeek")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer>
                        <BarChart data={data.byWeekday}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="label" fontSize={12} />
                          <YAxis fontSize={11} />
                          <Tooltip />
                          <Bar
                            dataKey="orders"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                            onClick={(d: any) => d?.weekday !== undefined && setDrill({ kind: "weekday", value: d.weekday })}
                          >
                            {data.byWeekday.map((b, i) => (
                              <Cell key={i} fill={b.weekday === data.totals.peakWeekday ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.4)"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="weekly" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">Weekly Orders &amp; Revenue</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer>
                        <LineChart data={data.byWeek}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="week" fontSize={11} />
                          <YAxis yAxisId="left" fontSize={11} />
                          <YAxis yAxisId="right" orientation="right" fontSize={11} />
                          <Tooltip />
                          <Legend />
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="orders"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={{ cursor: "pointer" }}
                            activeDot={{
                              cursor: "pointer",
                              onClick: (_: any, payload: any) =>
                                payload?.payload?.week && setDrill({ kind: "week", value: payload.payload.week }),
                            }}
                          />
                          <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium flex items-center gap-2"><Trophy className="h-4 w-4" /> Weekly Top Seller</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>Week</TableHead><TableHead>Top Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(data.topByWeek).sort((a, b) => a[0].localeCompare(b[0])).map(([w, list]) => {
                            const t = list[0]; if (!t) return null;
                            return (
                              <TableRow key={w}>
                                <TableCell className="font-mono">{w}</TableCell>
                                <TableCell>{t.name}</TableCell>
                                <TableCell className="text-right">{t.qty}</TableCell>
                                <TableCell className="text-right">{fmtMoney(t.revenue)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="monthly" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">{t("app.salesAnalytics.charts.monthlyTrend")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer>
                        <BarChart data={data.byMonth}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="month" fontSize={11} />
                          <YAxis fontSize={11} />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey="orders"
                            fill="hsl(var(--primary))"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                            onClick={(d: any) => d?.month && setDrill({ kind: "month", value: d.month })}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="compare" className="space-y-4 mt-4">
                <ComparePanel data={data} fmtMoney={fmtMoney} />
              </TabsContent>

              <TabsContent value="top" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium flex items-center gap-2"><Trophy className="h-4 w-4" /> Top 15 Sellers</CardTitle>
                    <CardDescription>Across the full period, ranked by quantity sold.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>#</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Share</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.topOverall.map((t, i) => {
                          const share = data.totals.revenue > 0 ? (t.revenue / data.totals.revenue) * 100 : 0;
                          return (
                            <TableRow key={t.menu_item_id}>
                              <TableCell className="font-mono text-muted-foreground">{i + 1}</TableCell>
                              <TableCell className="font-medium">{t.name}</TableCell>
                              <TableCell className="text-right">{t.qty}</TableCell>
                              <TableCell className="text-right">{fmtMoney(t.revenue)}</TableCell>
                              <TableCell className="text-right">
                                <Badge variant="secondary">{share.toFixed(1)}%</Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              {drillTitle}
            </SheetTitle>
            <SheetDescription>
              Transactions and item breakdown for the selected slice · {rangeLabel(from, to)}
            </SheetDescription>
          </SheetHeader>

          {drillResult && (
            <div className="space-y-5 mt-5">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Orders</div>
                  <div className="text-lg font-light mt-1">{drillResult.orders.toLocaleString()}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Revenue</div>
                  <div className="text-lg font-light mt-1">{fmtMoney(drillResult.revenue)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg Ticket</div>
                  <div className="text-lg font-light mt-1">{fmtMoney(drillResult.avgTicket)}</div>
                </div>
              </div>

              {drillResult.paymentBreakdown.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Payment Method Breakdown
                  </div>
                  <div className="rounded-lg border overflow-hidden">
                    <ScrollArea className="max-h-[180px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Method</TableHead>
                            <TableHead className="text-right">Orders</TableHead>
                            <TableHead className="text-right">Revenue</TableHead>
                            <TableHead className="text-right">Share</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drillResult.paymentBreakdown.map((pm) => {
                            const share = drillResult.revenue ? (pm.revenue / drillResult.revenue) * 100 : 0;
                            return (
                              <TableRow key={pm.method}>
                                <TableCell className="capitalize font-medium">{pm.method}</TableCell>
                                <TableCell className="text-right">{pm.orders}</TableCell>
                                <TableCell className="text-right">{fmtMoney(pm.revenue)}</TableCell>
                                <TableCell className="text-right">
                                  <Badge variant="secondary">{share.toFixed(1)}%</Badge>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Item Breakdown ({drillResult.items.length})
                  {drill?.kind === "daypart" && drill.metric === "revenue" && (
                    <span className="ms-2 text-[10px] normal-case text-primary">{t("app.salesAnalytics.sortedByRevenue")}</span>
                  )}
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <ScrollArea className="max-h-[260px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-end">{t("app.salesAnalytics.tables.qty")}</TableHead>
                          <TableHead className="text-end">{t("app.salesAnalytics.tables.revenue")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drillResult.items.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                              No items found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          drillResult.items.map((it) => (
                            <TableRow key={it.id}>
                              <TableCell className="font-medium">{it.name}</TableCell>
                               <TableCell className="text-end">{it.qty}</TableCell>
                               <TableCell className="text-end">{fmtMoney(it.revenue)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Transactions ({drillResult.rows.length})
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <ScrollArea className="max-h-[320px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>ID</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drillResult.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                              No transactions found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          drillResult.rows.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-mono text-xs">
                                {format(new Date(r.created_at), "MMM d, HH:mm")}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {r.id.slice(0, 8)}
                              </TableCell>
                              <TableCell className="text-right">{fmtMoney(r.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function KpiCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between text-muted-foreground text-xs uppercase tracking-wide">
          <span>{label}</span>
          {icon}
        </div>
        <div className="text-2xl font-light mt-2">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}
// ===================== Compare Panel =====================

type SeriesPoint = { key: string; label: string; orders: number; revenue: number };

function buildDailySeries(rows: { ymd: string; total: number }[]): SeriesPoint[] {
  const m = new Map<string, { orders: number; revenue: number }>();
  rows.forEach((r) => {
    const cur = m.get(r.ymd) ?? { orders: 0, revenue: 0 };
    cur.orders++; cur.revenue += r.total; m.set(r.ymd, cur);
  });
  return Array.from(m.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ymd, v]) => ({ key: ymd, label: format(new Date(`${ymd}T00:00:00`), "EEE MMM d"), ...v }));
}

function DeltaCell({ current, previous, fmt }: { current: number; previous: number; fmt?: (n: number) => string }) {
  if (previous === 0 && current === 0) {
    return <span className="text-muted-foreground inline-flex items-center gap-1"><Minus className="h-3 w-3" />-</span>;
  }
  const pct = previous === 0 ? 100 : ((current - previous) / previous) * 100;
  const isUp = pct > 0.5;
  const isDown = pct < -0.5;
  const cls = isUp ? "text-success" : isDown ? "text-destructive" : "text-muted-foreground";
  const Icon = isUp ? ArrowUp : isDown ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(1)}%
      {fmt && (
        <span className="text-muted-foreground font-normal ms-1">
          ({current >= previous ? "+" : "−"}{fmt(Math.abs(current - previous))})
        </span>
      )}
    </span>
  );
}

function ComparisonTable({
  series,
  granularityLabel,
  fmtMoney,
}: {
  series: SeriesPoint[];
  granularityLabel: string;
  fmtMoney: (n: number) => string;
}) {
  const reversed = [...series].reverse(); // newest first
  return (
    <ScrollArea className="h-[420px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{granularityLabel}</TableHead>
            <TableHead className="text-right">Orders</TableHead>
            <TableHead className="text-right">Δ Orders</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Δ Revenue</TableHead>
            <TableHead className="text-right">Avg Ticket</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reversed.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                Not enough data for comparison.
              </TableCell>
            </TableRow>
          )}
          {reversed.map((p, idx) => {
            const prev = reversed[idx + 1]; // older period
            const avg = p.orders ? p.revenue / p.orders : 0;
            return (
              <TableRow key={p.key}>
                <TableCell className="font-medium">{p.label}</TableCell>
                <TableCell className="text-right">{p.orders.toLocaleString()}</TableCell>
                <TableCell className="text-right text-xs">
                  {prev ? <DeltaCell current={p.orders} previous={prev.orders} /> : <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell className="text-right">{fmtMoney(p.revenue)}</TableCell>
                <TableCell className="text-right text-xs">
                  {prev ? <DeltaCell current={p.revenue} previous={prev.revenue} fmt={fmtMoney} /> : <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{fmtMoney(avg)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function ComparePanel({
  data,
  fmtMoney,
}: {
  data: ReturnType<typeof useSalesAnalytics>["data"] extends infer T ? NonNullable<T> : never;
  fmtMoney: (n: number) => string;
}) {
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");

  const daily = useMemo(() => buildDailySeries(data.rows), [data.rows]);
  const weekly: SeriesPoint[] = useMemo(
    () => data.byWeek.map((w) => ({ key: w.week, label: w.week, orders: w.orders, revenue: w.revenue })),
    [data.byWeek],
  );
  const monthly: SeriesPoint[] = useMemo(
    () => data.byMonth.map((m) => ({
      key: m.month,
      label: format(new Date(`${m.month}-01T00:00:00`), "MMM yyyy"),
      orders: m.orders,
      revenue: m.revenue,
    })),
    [data.byMonth],
  );

  const series = granularity === "day" ? daily : granularity === "week" ? weekly : monthly;
  const label = granularity === "day" ? "Day" : granularity === "week" ? "ISO Week" : "Month";

  // Headline: latest vs previous
  const latest = series[series.length - 1];
  const prev = series[series.length - 2];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <GitCompare className="h-4 w-4" />
              Period-over-Period Comparison
            </CardTitle>
            <CardDescription>
              Compare each {granularity} against the one before it across the selected range.
            </CardDescription>
          </div>
          <Select value={granularity} onValueChange={(v) => setGranularity(v as any)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day over Day</SelectItem>
              <SelectItem value="week">Week over Week</SelectItem>
              <SelectItem value="month">Month over Month</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-4">
          {latest && prev && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Latest {label}</div>
                <div className="text-lg font-light mt-1">{latest.label}</div>
                <div className="text-xs text-muted-foreground mt-1">vs {prev.label}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Orders</div>
                <div className="text-lg font-light mt-1">{latest.orders.toLocaleString()}</div>
                <div className="mt-1 text-xs"><DeltaCell current={latest.orders} previous={prev.orders} /></div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Revenue</div>
                <div className="text-lg font-light mt-1">{fmtMoney(latest.revenue)}</div>
                <div className="mt-1 text-xs"><DeltaCell current={latest.revenue} previous={prev.revenue} fmt={fmtMoney} /></div>
              </div>
            </div>
          )}

          <div className="h-[280px] w-full">
            <ResponsiveContainer>
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis yAxisId="left" fontSize={11} />
                <YAxis yAxisId="right" orientation="right" fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="orders" fill="hsl(var(--primary) / 0.5)" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="revenue" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ComparisonTable series={series} granularityLabel={label} fmtMoney={fmtMoney} />
        </CardContent>
      </Card>
    </div>
  );
}
