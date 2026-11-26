import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { Activity, Move, Maximize2, Shapes, Pencil, Users, RotateCw, Trash2, Plus, ArrowRight, History } from "lucide-react";

type LayoutRow = {
  id: string;
  entity_type: "floor_plan" | "table";
  action: string;
  label: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  changed_by: string | null;
  occurred_at: string;
  floor_plan_id: string | null;
  table_id: string | null;
};

type StatusRow = {
  id: string;
  table_id: string;
  from_status: string | null;
  to_status: string;
  guest_count: number | null;
  changed_by: string | null;
  occurred_at: string;
  floor_plan_id: string | null;
};

type Unified =
  | { kind: "layout"; row: LayoutRow }
  | { kind: "status"; row: StatusRow };

const ACTION_ICON: Record<string, typeof Move> = {
  create: Plus,
  move: Move,
  resize: Maximize2,
  reshape: Shapes,
  rename: Pencil,
  recapacity: Users,
  rotate: RotateCw,
  delete: Trash2,
  restore: Plus,
  update: Pencil,
};

function todayStart() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export default function FloorAuditLog() {
  const { restaurant } = useAuth();
  const tenantId = restaurant?.tenant_id;

  const [from, setFrom] = useState(format(todayStart(), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfToday(), "yyyy-MM-dd"));
  const [filter, setFilter] = useState<"all" | "layout" | "status">("all");

  const fromIso = useMemo(() => new Date(from + "T00:00:00").toISOString(), [from]);
  const toIso = useMemo(() => new Date(to + "T23:59:59.999").toISOString(), [to]);

  const layoutQuery = useQuery({
    queryKey: ["floor-audit-layout", tenantId, fromIso, toIso],
    queryFn: async () => {
      if (!tenantId) return [] as LayoutRow[];
      const { data, error } = await db
        .from("pos_floor_audit_log")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("occurred_at", fromIso)
        .lte("occurred_at", toIso)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as unknown as LayoutRow[];
    },
    enabled: !!tenantId,
  });

  const statusQuery = useQuery({
    queryKey: ["floor-audit-status", tenantId, fromIso, toIso],
    queryFn: async () => {
      if (!tenantId) return [] as StatusRow[];
      const { data, error } = await db
        .from("pos_table_status_events")
        .select("id,table_id,from_status,to_status,guest_count,changed_by,occurred_at,floor_plan_id")
        .eq("tenant_id", tenantId)
        .gte("occurred_at", fromIso)
        .lte("occurred_at", toIso)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as unknown as StatusRow[];
    },
    enabled: !!tenantId,
  });

  // Resolve user names + table labels
  const userIds = useMemo(() => {
    const s = new Set<string>();
    (layoutQuery.data || []).forEach((r) => r.changed_by && s.add(r.changed_by));
    (statusQuery.data || []).forEach((r) => r.changed_by && s.add(r.changed_by));
    return Array.from(s);
  }, [layoutQuery.data, statusQuery.data]);

  const tableIds = useMemo(() => {
    const s = new Set<string>();
    (statusQuery.data || []).forEach((r) => r.table_id && s.add(r.table_id));
    (layoutQuery.data || []).forEach((r) => r.table_id && s.add(r.table_id));
    return Array.from(s);
  }, [layoutQuery.data, statusQuery.data]);

  const profilesQuery = useQuery({
    queryKey: ["floor-audit-profiles", userIds.join(",")],
    queryFn: async () => {
      if (userIds.length === 0) return {} as Record<string, string>;
      const { data } = await db.from("profiles").select("id,full_name").in("id", userIds);
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { m[p.id] = p.full_name || "Unknown"; });
      return m;
    },
    enabled: userIds.length > 0,
  });

  const tablesQuery = useQuery({
    queryKey: ["floor-audit-tables", tableIds.join(",")],
    queryFn: async () => {
      if (tableIds.length === 0) return {} as Record<string, string>;
      const { data } = await db.from("pos_tables").select("id,label").in("id", tableIds);
      const m: Record<string, string> = {};
      (data || []).forEach((t: any) => { m[t.id] = t.label; });
      return m;
    },
    enabled: tableIds.length > 0,
  });

  const events = useMemo<Unified[]>(() => {
    const arr: Unified[] = [];
    if (filter !== "status") (layoutQuery.data || []).forEach((row) => arr.push({ kind: "layout", row }));
    if (filter !== "layout") (statusQuery.data || []).forEach((row) => arr.push({ kind: "status", row }));
    arr.sort((a, b) => (a.row.occurred_at < b.row.occurred_at ? 1 : -1));
    return arr;
  }, [layoutQuery.data, statusQuery.data, filter]);

  const userName = (id: string | null) => (id ? profilesQuery.data?.[id] ?? "Unknown user" : "System");
  const tableLabel = (id: string | null) => (id ? tablesQuery.data?.[id] ?? "Table" : "—");

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
          <History className="h-5 w-5 text-primary" /> Floor Plan Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every layout edit and table-status change, with who and when.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Show</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                <SelectItem value="layout">Layout edits only</SelectItem>
                <SelectItem value="status">Status changes only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[70vh]">
            {events.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No activity in this period.
              </div>
            ) : (
              <ul className="divide-y">
                {events.map((ev) => (
                  <li key={`${ev.kind}-${ev.row.id}`} className="px-4 py-3 flex items-start gap-3">
                    {ev.kind === "layout" ? (
                      (() => {
                        const Icon = ACTION_ICON[ev.row.action] ?? Pencil;
                        return (
                          <>
                            <div className="mt-0.5 rounded-md bg-muted p-1.5">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-sm">
                                <Badge variant="outline" className="text-[10px] uppercase">{ev.row.entity_type === "floor_plan" ? "Floor" : "Table"}</Badge>
                                <span className="font-medium">{ev.row.label || tableLabel(ev.row.table_id)}</span>
                                <span className="text-muted-foreground">·</span>
                                <span className="capitalize text-muted-foreground">{ev.row.action}</span>
                              </div>
                              <ChangeDetail row={ev.row} />
                              <div className="text-xs text-muted-foreground mt-1">
                                {userName(ev.row.changed_by)} · {format(new Date(ev.row.occurred_at), "MMM d, HH:mm:ss")}
                              </div>
                            </div>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <div className="mt-0.5 rounded-md bg-muted p-1.5">
                          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm flex-wrap">
                            <Badge variant="outline" className="text-[10px] uppercase">Status</Badge>
                            <span className="font-medium">{tableLabel(ev.row.table_id)}</span>
                            <span className="text-muted-foreground inline-flex items-center gap-1">
                              {ev.row.from_status ?? "—"} <ArrowRight className="h-3 w-3" /> <span className="text-foreground">{ev.row.to_status}</span>
                            </span>
                            {ev.row.guest_count != null && (
                              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                                <Users className="h-3 w-3" />{ev.row.guest_count}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {userName(ev.row.changed_by)} · {format(new Date(ev.row.occurred_at), "MMM d, HH:mm:ss")}
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function ChangeDetail({ row }: { row: LayoutRow }) {
  const entries = Object.entries(row.changes || {});
  if (entries.length === 0) return null;
  return (
    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
      {entries.map(([field, diff]) => (
        <span key={field} className="inline-flex items-center gap-1">
          <span className="text-foreground/70">{field}:</span>
          <span>{String(diff.from ?? "—")}</span>
          <ArrowRight className="h-3 w-3" />
          <span className="text-foreground">{String(diff.to ?? "—")}</span>
        </span>
      ))}
    </div>
  );
}