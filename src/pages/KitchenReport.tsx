import { useMemo, useState } from "react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { CalendarIcon, ChefHat, Download, Clock, CheckCircle2, XCircle, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useKdsStations } from "@/hooks/useKDS";

type Preset = "today" | "yesterday" | "7d" | "30d" | "custom";

function fmtDuration(seconds: number | null): string {
  if (seconds == null || !isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
}

function avg(nums: number[]): number | null {
  const valid = nums.filter((n) => isFinite(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export default function KitchenReport() {
  const { restaurant } = useAuth();
  const rid = restaurant?.id;
  const { stations } = useKdsStations();

  const [preset, setPreset] = useState<Preset>("today");
  const [from, setFrom] = useState<Date>(startOfDay(new Date()));
  const [to, setTo] = useState<Date>(endOfDay(new Date()));
  const [stationId, setStationId] = useState<string | "all">("all");

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const now = new Date();
    if (p === "today") { setFrom(startOfDay(now)); setTo(endOfDay(now)); }
    else if (p === "yesterday") {
      const y = subDays(now, 1);
      setFrom(startOfDay(y)); setTo(endOfDay(y));
    }
    else if (p === "7d") { setFrom(startOfDay(subDays(now, 6))); setTo(endOfDay(now)); }
    else if (p === "30d") { setFrom(startOfDay(subDays(now, 29))); setTo(endOfDay(now)); }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["kitchen-report", rid, from.toISOString(), to.toISOString(), stationId],
    enabled: !!rid,
    queryFn: async () => {
      const { data: tickets, error } = await db
        .from("pos_kds_tickets" as any)
        .select("*")
        .eq("restaurant_id", rid)
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (tickets || []).map((t: any) => t.id);
      let items: any[] = [];
      if (ids.length) {
        let q = db.from("pos_kds_ticket_items" as any).select("*").in("ticket_id", ids);
        if (stationId !== "all") q = q.eq("station_id", stationId);
        const { data: it, error: e2 } = await q;
        if (e2) throw e2;
        items = it || [];
      }
      // If filtering by station, only keep tickets that have items in that station
      let filteredTickets = (tickets || []) as any[];
      if (stationId !== "all") {
        const keep = new Set(items.map((i) => i.ticket_id));
        filteredTickets = filteredTickets.filter((t) => keep.has(t.id));
      }
      return { tickets: filteredTickets, items };
    },
  });

  const stats = useMemo(() => {
    const tickets = data?.tickets || [];
    const items = data?.items || [];
    const served = tickets.filter((t: any) => t.status === "served");
    const cancelled = tickets.filter((t: any) => t.status === "cancelled");
    const active = tickets.filter((t: any) => ["new", "in_progress", "ready"].includes(t.status));

    const prepTimes = served
      .filter((t: any) => t.ready_at && t.created_at)
      .map((t: any) => (new Date(t.ready_at).getTime() - new Date(t.created_at).getTime()) / 1000);
    const serviceTimes = served
      .filter((t: any) => t.served_at && t.ready_at)
      .map((t: any) => (new Date(t.served_at).getTime() - new Date(t.ready_at).getTime()) / 1000);
    const totalTimes = served
      .filter((t: any) => t.served_at && t.created_at)
      .map((t: any) => (new Date(t.served_at).getTime() - new Date(t.created_at).getTime()) / 1000);

    // Station breakdown
    const stationMap = new Map<string, { tickets: Set<string>; items: number; qty: number }>();
    items.forEach((it: any) => {
      const sid = it.station_id || "_none";
      if (!stationMap.has(sid)) stationMap.set(sid, { tickets: new Set(), items: 0, qty: 0 });
      const e = stationMap.get(sid)!;
      e.tickets.add(it.ticket_id);
      e.items += 1;
      e.qty += Number(it.quantity) || 0;
    });

    // Top items by qty
    const itemMap = new Map<string, number>();
    items.forEach((it: any) => {
      const k = it.name_snapshot || "Unknown";
      itemMap.set(k, (itemMap.get(k) || 0) + (Number(it.quantity) || 0));
    });
    const topItems = Array.from(itemMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      total: tickets.length,
      served: served.length,
      cancelled: cancelled.length,
      active: active.length,
      avgPrep: avg(prepTimes),
      avgService: avg(serviceTimes),
      avgTotal: avg(totalTimes),
      stationMap,
      topItems,
      tickets,
    };
  }, [data]);

  const exportCSV = () => {
    const rows: string[] = [];
    rows.push(["Ticket #", "Source", "Table", "Status", "Created", "Started", "Ready", "Served", "Prep (s)", "Service (s)"].join(","));
    (stats.tickets || []).forEach((t: any) => {
      const prep = t.ready_at && t.created_at
        ? Math.round((new Date(t.ready_at).getTime() - new Date(t.created_at).getTime()) / 1000)
        : "";
      const svc = t.served_at && t.ready_at
        ? Math.round((new Date(t.served_at).getTime() - new Date(t.ready_at).getTime()) / 1000)
        : "";
      rows.push([
        t.ticket_number, t.source, t.table_label || "", t.status,
        t.created_at || "", t.started_at || "", t.ready_at || "", t.served_at || "",
        prep, svc,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kitchen-report-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stationName = (id: string) =>
    id === "_none" ? "Unassigned" : stations.find((s) => s.id === id)?.name || "Unknown";

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap min-h-[56px]">
        <div className="flex items-center gap-3 min-w-[240px] flex-1">
          <ChefHat className="h-5 w-5 text-primary" />
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Kitchen Report</h1>
            <p className="text-sm text-muted-foreground mt-1">Performance, throughput & timing</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={!stats.tickets?.length}>
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <Tabs value={preset} onValueChange={(v) => applyPreset(v as Preset)}>
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="yesterday">Yesterday</TabsTrigger>
            <TabsTrigger value="7d">Last 7 days</TabsTrigger>
            <TabsTrigger value="30d">Last 30 days</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>
        </Tabs>

        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="justify-start font-normal">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {format(from, "PP")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={from} onSelect={(d) => d && setFrom(startOfDay(d))} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            <span className="text-muted-foreground text-sm">→</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="justify-start font-normal">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {format(to, "PP")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={to} onSelect={(d) => d && setTo(endOfDay(d))} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
          </div>
        )}

        <Select value={stationId} onValueChange={(v) => setStationId(v as any)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All stations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stations</SelectItem>
            {stations.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Tickets</span>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-light">{stats.total}</div>
          <div className="text-xs text-muted-foreground mt-1">
            <span className="text-foreground">{stats.served}</span> served · <span className="text-foreground">{stats.active}</span> active
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Avg Prep</span>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-light">{fmtDuration(stats.avgPrep)}</div>
          <div className="text-xs text-muted-foreground mt-1">created → ready</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Avg Service</span>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-light">{fmtDuration(stats.avgService)}</div>
          <div className="text-xs text-muted-foreground mt-1">ready → served</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Cancelled</span>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-light">{stats.cancelled}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {stats.total ? `${Math.round((stats.cancelled / stats.total) * 100)}% of total` : "—"}
          </div>
        </Card>
      </div>

      {/* Station breakdown + top items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Station Breakdown</h2>
          {stats.stationMap.size === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No data</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Station</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(stats.stationMap.entries()).map(([sid, e]) => (
                  <TableRow key={sid}>
                    <TableCell className="font-medium">{stationName(sid)}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.tickets.size}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.items}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.qty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Top Items</h2>
          {stats.topItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No data</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.topItems.map(([name, qty]) => (
                  <TableRow key={name}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="text-right tabular-nums">{qty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      {/* Ticket history */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">Tickets ({stats.tickets.length})</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : stats.tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No tickets in range</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Prep</TableHead>
                <TableHead className="text-right">Service</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.tickets.slice(0, 100).map((t: any) => {
                const prep = t.ready_at && t.created_at
                  ? (new Date(t.ready_at).getTime() - new Date(t.created_at).getTime()) / 1000
                  : null;
                const svc = t.served_at && t.ready_at
                  ? (new Date(t.served_at).getTime() - new Date(t.ready_at).getTime()) / 1000
                  : null;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.ticket_number}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{t.source}</Badge></TableCell>
                    <TableCell>{t.table_label || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={t.status === "served" ? "default" : t.status === "cancelled" ? "destructive" : "secondary"} className="text-xs capitalize">
                        {t.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{format(new Date(t.created_at), "MMM d, HH:mm")}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{fmtDuration(prep)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{fmtDuration(svc)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {stats.tickets.length > 100 && (
          <p className="text-xs text-muted-foreground mt-3 text-center">Showing 100 of {stats.tickets.length} · export CSV for all</p>
        )}
      </Card>
    </div>
  );
}