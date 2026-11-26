import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, differenceInMinutes } from "date-fns";
import { Calendar as CalendarIcon, Clock, Users, ArrowRight, LayoutGrid } from "lucide-react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useFloorPlans } from "@/hooks/useFloorPlan";

type TableStatus = "free" | "seated" | "ordered" | "billing" | "dirty";

interface StatusEvent {
  id: string;
  table_id: string;
  from_status: TableStatus | null;
  to_status: TableStatus;
  guest_count: number | null;
  occurred_at: string;
}

interface PosTableRow {
  id: string;
  label: string;
  capacity: number;
  floor_plan_id: string | null;
}

const STATUS_STYLES: Record<TableStatus, string> = {
  free:    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/40",
  seated:  "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40",
  ordered: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/40",
  billing: "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/40",
  dirty:   "bg-muted text-muted-foreground ring-1 ring-border",
};

const STATUS_LABEL: Record<TableStatus, string> = {
  free: "Cleared",
  seated: "Seated",
  ordered: "Ordered",
  billing: "Billed",
  dirty: "Dirty",
};

function fmtDuration(mins: number) {
  if (mins < 1) return "<1m";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function TableTimeline() {
  const { restaurant } = useAuth();
  const tenantId = restaurant?.tenant_id ?? null;
  const { plans } = useFloorPlans();

  const [from, setFrom] = useState<Date>(startOfDay(new Date()));
  const [to, setTo] = useState<Date>(endOfDay(new Date()));
  const [planId, setPlanId] = useState<string>("all");

  // Tables (for labels + filter scope)
  const { data: tables = [] } = useQuery({
    queryKey: ["pos_tables_for_timeline", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db
        .from("pos_tables")
        .select("id, label, capacity, floor_plan_id")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      return (data ?? []) as PosTableRow[];
    },
  });

  const visibleTableIds = useMemo(() => {
    const filtered = planId === "all" ? tables : tables.filter((t) => t.floor_plan_id === planId);
    return new Set(filtered.map((t) => t.id));
  }, [tables, planId]);

  const tableMap = useMemo(() => {
    const m = new Map<string, PosTableRow>();
    tables.forEach((t) => m.set(t.id, t));
    return m;
  }, [tables]);

  // Events
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["pos_table_status_events", tenantId, from.toISOString(), to.toISOString()],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await db
        .from("pos_table_status_events")
        .select("id, table_id, from_status, to_status, guest_count, occurred_at")
        .eq("tenant_id", tenantId!)
        .gte("occurred_at", from.toISOString())
        .lte("occurred_at", to.toISOString())
        .order("occurred_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as StatusEvent[];
    },
  });

  const scopedEvents = useMemo(
    () => events.filter((e) => visibleTableIds.has(e.table_id)),
    [events, visibleTableIds],
  );

  // Group events into turns (seated → cleared) per table
  type Turn = {
    key: string;
    table_id: string;
    seated_at?: string;
    ordered_at?: string;
    billed_at?: string;
    cleared_at?: string;
    guests?: number;
  };

  const turns = useMemo<Turn[]>(() => {
    const byTable = new Map<string, StatusEvent[]>();
    scopedEvents.forEach((e) => {
      const arr = byTable.get(e.table_id) ?? [];
      arr.push(e);
      byTable.set(e.table_id, arr);
    });

    const out: Turn[] = [];
    byTable.forEach((evs, tableId) => {
      let current: Turn | null = null;
      evs.forEach((e) => {
        if (e.to_status === "seated") {
          if (current) out.push(current);
          current = {
            key: e.id,
            table_id: tableId,
            seated_at: e.occurred_at,
            guests: e.guest_count ?? undefined,
          };
        } else if (e.to_status === "ordered") {
          if (!current) current = { key: e.id, table_id: tableId };
          if (!current.ordered_at) current.ordered_at = e.occurred_at;
        } else if (e.to_status === "billing") {
          if (!current) current = { key: e.id, table_id: tableId };
          current.billed_at = e.occurred_at;
        } else if (e.to_status === "free" || e.to_status === "dirty") {
          if (!current) current = { key: e.id, table_id: tableId };
          current.cleared_at = e.occurred_at;
          out.push(current);
          current = null;
        }
      });
      if (current) out.push(current);
    });

    return out.sort((a, b) => {
      const ax = a.seated_at ?? a.ordered_at ?? a.billed_at ?? a.cleared_at ?? "";
      const bx = b.seated_at ?? b.ordered_at ?? b.billed_at ?? b.cleared_at ?? "";
      return bx.localeCompare(ax);
    });
  }, [scopedEvents]);

  // KPIs
  const completedTurns = turns.filter((t) => t.seated_at && t.cleared_at);
  const avgTurnMins = completedTurns.length
    ? completedTurns.reduce((sum, t) => sum + differenceInMinutes(new Date(t.cleared_at!), new Date(t.seated_at!)), 0) /
      completedTurns.length
    : 0;
  const totalGuests = turns.reduce((s, t) => s + (t.guests ?? 0), 0);

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Table Timeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every seat, order, bill, and clear across the selected range.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All floors</SelectItem>
              {plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DatePick label="From" date={from} onChange={(d) => setFrom(startOfDay(d))} />
          <DatePick label="To" date={to} onChange={(d) => setTo(endOfDay(d))} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setFrom(startOfDay(new Date())); setTo(endOfDay(new Date())); }}
          >
            Today
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Turns" value={turns.length} />
        <Kpi label="Completed" value={completedTurns.length} />
        <Kpi label="Avg turn time" value={completedTurns.length ? fmtDuration(avgTurnMins) : "—"} />
        <Kpi label="Guests served" value={totalGuests} />
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[70vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Guests</TableHead>
                  <TableHead>Seated</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead>Billed</TableHead>
                  <TableHead>Cleared</TableHead>
                  <TableHead className="text-right">Turn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && turns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-16">
                      <LayoutGrid className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm font-medium">No table activity</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Try a wider date range or seat a table from the Floor Plan.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
                {turns.map((t) => {
                  const table = tableMap.get(t.table_id);
                  const turnMins = t.seated_at && t.cleared_at
                    ? differenceInMinutes(new Date(t.cleared_at), new Date(t.seated_at))
                    : null;
                  return (
                    <TableRow key={t.key}>
                      <TableCell className="font-medium">{table?.label ?? "—"}</TableCell>
                      <TableCell>
                        {t.guests ? (
                          <span className="inline-flex items-center gap-1 text-sm">
                            <Users className="h-3 w-3 text-muted-foreground" />{t.guests}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <Stamp at={t.seated_at} status="seated" />
                      <Stamp at={t.ordered_at} status="ordered" />
                      <Stamp at={t.billed_at} status="billing" />
                      <Stamp at={t.cleared_at} status="free" />
                      <TableCell className="text-right text-sm tabular-nums">
                        {turnMins != null ? fmtDuration(turnMins) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function Stamp({ at, status }: { at?: string; status: TableStatus }) {
  if (!at) return <TableCell><span className="text-muted-foreground text-sm">—</span></TableCell>;
  return (
    <TableCell>
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_STYLES[status])}>
          {STATUS_LABEL[status]}
        </span>
        <span className="text-sm tabular-nums">{format(new Date(at), "HH:mm")}</span>
        <span className="text-[10px] text-muted-foreground">{format(new Date(at), "MMM d")}</span>
      </div>
    </TableCell>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="text-2xl font-light mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function DatePick({ label, date, onChange }: { label: string; date: Date; onChange: (d: Date) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="font-normal">
          <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
          <span className="text-muted-foreground mr-1">{label}:</span>
          {format(date, "MMM d, yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar mode="single" selected={date} onSelect={(d) => d && onChange(d)} initialFocus className={cn("p-3 pointer-events-auto")} />
      </PopoverContent>
    </Popover>
  );
}