import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, RefreshCw, CheckCircle2, Filter, ShieldCheck, RotateCw, Download, Trash2, Layers,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import { DlqItemTraceDialog, type DlqTraceRow } from "@/components/admin/DlqItemTraceDialog";

type DLQRow = DlqTraceRow & {
  restaurant_id: string | null;
  resolved_at: string | null;
  approved_by?: string | null;
};

type BulkAction = "approve" | "retry" | "resolve" | "discard";

const STATUS_OPTIONS = ["all", "open", "retrying", "resolved", "discarded"] as const;

const ACTION_META: Record<BulkAction, { label: string; description: string; destructive?: boolean }> = {
  approve: {
    label: "Approve for reprocess",
    description: "Marks the selected items as reviewed and safe to send again. No data is sent yet.",
  },
  retry: {
    label: "Reprocess now",
    description:
      "Approves (if needed) and queues the selected items for another sync attempt. Idempotency keys are preserved, so an event already applied server-side will be acknowledged as a duplicate instead of double-posted.",
  },
  resolve: {
    label: "Mark resolved",
    description: "Closes the items without resending — use when the data was corrected or entered manually.",
  },
  discard: {
    label: "Discard",
    description: "Permanently parks the items as discarded. They will never be resent. A reason is required.",
    destructive: true,
  },
};

function statusBadge(s: string) {
  if (s === "open") return <Badge variant="destructive">Open</Badge>;
  if (s === "retrying") return <Badge className="bg-amber-500">Retrying</Badge>;
  if (s === "resolved") return <Badge className="bg-emerald-600">Resolved</Badge>;
  return <Badge variant="secondary">Discarded</Badge>;
}

function classifyError(msg: string): string {
  const m = (msg ?? "").toLowerCase();
  if (/version|stale|conflict|409/.test(m)) return "version_conflict";
  if (/validation|invalid|schema|zod|400/.test(m)) return "validation";
  if (/auth|unauthorized|forbidden|401|403/.test(m)) return "auth";
  if (/cors|network|fetch|timeout|dns|offline/.test(m)) return "network";
  if (/rate|429|throttle/.test(m)) return "rate_limit";
  if (/500|502|503|504|server/.test(m)) return "server";
  return "other";
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: DLQRow[]) {
  const headers = [
    "created_at","status","tenant_id","branch_id","terminal_id","batch_id","request_id",
    "event_type","event_id","http_status","error_type","error_message","retry_count","max_retries",
    "retry_exhausted","operator_approved","retry_requested_at","resolved_at","request_trace","response_trace",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.created_at, r.status, r.tenant_id, r.branch_id, r.terminal_id, r.batch_id, r.request_id,
      r.event_type, r.event_id, r.http_status, r.error_category ?? classifyError(r.error_message),
      r.error_message, r.retry_count, r.max_retries, r.retry_exhausted, r.operator_approved ?? false,
      r.retry_requested_at ?? "", r.resolved_at ?? "", r.request_trace, r.response_trace,
    ].map(csvEscape).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dlq-failed-sync-items-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface BatchGroup {
  batchId: string;
  requestId: string | null;
  terminalId: string | null;
  branchId: string | null;
  httpStatus: number | null;
  firstSeen: string;
  items: DLQRow[];
  open: number;
  exhausted: number;
  errorMessage: string;
}

export default function AdminDLQ() {
  const [rows, setRows] = useState<DLQRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailRow, setDetailRow] = useState<DLQRow | null>(null);
  const [tenantFilter, setTenantFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [terminalFilter, setTerminalFilter] = useState("all");
  const [errorFilter, setErrorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [exhaustedOnly, setExhaustedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<{ action: BulkAction; ids: string[]; batchId?: string } | null>(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("failed_sync_items")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data as DLQRow[]) ?? []);
      setSelected(new Set());
    } catch (err: any) {
      toast.error(`Failed to load DLQ: ${err.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const tenants = useMemo(() => Array.from(new Set(rows.map((r) => r.tenant_id))).sort(), [rows]);
  const branches = useMemo(
    () => Array.from(new Set(rows.map((r) => r.branch_id).filter(Boolean) as string[])).sort(), [rows]);
  const terminals = useMemo(
    () => Array.from(new Set(rows.map((r) => r.terminal_id).filter(Boolean) as string[])).sort(), [rows]);
  const errorTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.error_category ?? classifyError(r.error_message)))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tenantFilter !== "all" && r.tenant_id !== tenantFilter) return false;
      if (branchFilter !== "all" && r.branch_id !== branchFilter) return false;
      if (terminalFilter !== "all" && r.terminal_id !== terminalFilter) return false;
      if (errorFilter !== "all" && (r.error_category ?? classifyError(r.error_message)) !== errorFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (exhaustedOnly && !r.retry_exhausted) return false;
      if (q && !`${r.event_type} ${r.error_message} ${r.event_id ?? ""} ${r.batch_id ?? ""} ${r.request_id ?? ""}`
        .toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, tenantFilter, branchFilter, terminalFilter, errorFilter, statusFilter, exhaustedOnly, search]);

  const batches = useMemo<BatchGroup[]>(() => {
    const map = new Map<string, BatchGroup>();
    for (const r of filtered) {
      const key = r.batch_id ?? `unbatched:${r.terminal_id ?? "unknown"}`;
      const g = map.get(key) ?? {
        batchId: key,
        requestId: r.request_id ?? null,
        terminalId: r.terminal_id,
        branchId: r.branch_id,
        httpStatus: r.http_status ?? null,
        firstSeen: r.created_at,
        items: [],
        open: 0,
        exhausted: 0,
        errorMessage: r.error_message,
      };
      g.items.push(r);
      if (r.status === "open" || r.status === "retrying") g.open += 1;
      if (r.retry_exhausted) g.exhausted += 1;
      if (r.created_at < g.firstSeen) g.firstSeen = r.created_at;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
  }, [filtered]);

  const runAction = async () => {
    if (!pendingAction) return;
    const { action, ids, batchId } = pendingAction;
    if (action === "discard" && !reason.trim()) {
      toast.error("A reason is required to discard items.");
      return;
    }
    setWorking(true);
    try {
      let count: number;
      if (batchId && action === "retry") {
        const { data, error } = await (supabase as any).rpc("reprocess_failed_sync_batch", {
          _batch_id: batchId,
          _reason: reason.trim() || "batch reprocess",
        });
        if (error) throw error;
        count = Number(data ?? 0);
      } else {
        const { data, error } = await (supabase as any).rpc("bulk_manage_failed_sync_items", {
          _ids: ids,
          _action: action,
          _reason: reason.trim() || null,
        });
        if (error) throw error;
        count = Number(data ?? 0);
      }
      toast.success(`${ACTION_META[action].label}: ${count} item${count === 1 ? "" : "s"} updated.`);
      setPendingAction(null);
      setReason("");
      await load();
    } catch (err: any) {
      toast.error(`Action failed: ${err.message ?? err}`);
    } finally {
      setWorking(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const selectedIds = Array.from(selected);

  const openCount = rows.filter((r) => r.status === "open").length;
  const retryingCount = rows.filter((r) => r.status === "retrying").length;
  const exhaustedCount = rows.filter((r) => r.retry_exhausted && r.status !== "resolved").length;
  const batchCount = new Set(rows.filter((r) => r.batch_id && r.status === "open").map((r) => r.batch_id)).size;

  return (
    <div className="p-6 space-y-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            Dead-Letter Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            POS sync events that exceeded their retry budget, grouped by the HTTP batch that failed. Latest 500 records.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Open" value={openCount} />
        <SummaryCard label="Retrying" value={retryingCount} />
        <SummaryCard label="Retries exhausted" value={exhaustedCount} tone={exhaustedCount ? "bad" : undefined} />
        <SummaryCard label="Failed batches (open)" value={batchCount} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <FilterSelect label="Tenant" value={tenantFilter} onChange={setTenantFilter} options={tenants} short />
            <FilterSelect label="Branch" value={branchFilter} onChange={setBranchFilter} options={branches} short />
            <FilterSelect label="Terminal" value={terminalFilter} onChange={setTerminalFilter} options={terminals} short />
            <FilterSelect label="Error type" value={errorFilter} onChange={setErrorFilter} options={errorTypes} />
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Search</Label>
              <Input
                placeholder="event / error / batch id"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 mt-3 text-xs cursor-pointer w-fit">
            <Checkbox checked={exhaustedOnly} onCheckedChange={(v) => setExhaustedOnly(!!v)} />
            Only items that exceeded max retries
          </label>
        </CardContent>
      </Card>

      {selectedIds.length > 0 && (
        <Card className="border-primary/40">
          <CardContent className="py-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium mr-2">{selectedIds.length} selected</span>
            <Button size="sm" variant="outline" onClick={() => setPendingAction({ action: "approve", ids: selectedIds })}>
              <ShieldCheck className="h-4 w-4 mr-1" /> Approve
            </Button>
            <Button size="sm" onClick={() => setPendingAction({ action: "retry", ids: selectedIds })}>
              <RotateCw className="h-4 w-4 mr-1" /> Reprocess
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPendingAction({ action: "resolve", ids: selectedIds })}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Resolve
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setPendingAction({ action: "discard", ids: selectedIds })}>
              <Trash2 className="h-4 w-4 mr-1" /> Discard
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="batches">
        <TabsList>
          <TabsTrigger value="batches">
            <Layers className="h-4 w-4 mr-2" /> Batches ({batches.length})
          </TabsTrigger>
          <TabsTrigger value="items">Events ({filtered.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="batches" className="space-y-3">
          {batches.length === 0 && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : "No failed batches match these filters."}
            </CardContent></Card>
          )}
          {batches.map((b) => {
            const isReal = !b.batchId.startsWith("unbatched:");
            return (
              <Card key={b.batchId}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm font-medium flex flex-wrap items-center gap-2">
                        {isReal ? <span className="font-mono text-xs">{b.batchId.slice(0, 8)}…</span> : "Unbatched (legacy)"}
                        <Badge variant="outline">{b.items.length} event{b.items.length === 1 ? "" : "s"}</Badge>
                        {b.exhausted > 0 && <Badge variant="destructive">{b.exhausted} exhausted</Badge>}
                        {b.httpStatus != null && <Badge variant="secondary">HTTP {b.httpStatus}</Badge>}
                      </CardTitle>
                      <CardDescription className="mt-1 text-xs break-words">
                        {format(new Date(b.firstSeen), "PPpp")} · terminal {b.terminalId?.slice(0, 8) ?? "—"} ·{" "}
                        {b.errorMessage}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelected(new Set(b.items.map((i) => i.id)))}
                      >
                        Select all
                      </Button>
                      <Button
                        size="sm"
                        disabled={b.open === 0}
                        onClick={() =>
                          setPendingAction(
                            isReal
                              ? { action: "retry", ids: b.items.map((i) => i.id), batchId: b.batchId }
                              : { action: "retry", ids: b.items.map((i) => i.id) },
                          )
                        }
                      >
                        <RotateCw className="h-4 w-4 mr-1" /> Reprocess batch
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {b.items.map((i) => (
                      <button
                        key={i.id}
                        onClick={() => setDetailRow(i)}
                        className="text-[11px] font-mono rounded border px-2 py-1 hover:bg-muted transition-colors"
                        title={i.error_message}
                      >
                        {i.event_type}·{(i.event_id ?? i.id).slice(0, 12)} · {i.status}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="items">
          <Card>
            <CardContent className="pt-6">
              <ScrollArea className="max-h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={(v) =>
                            setSelected(v ? new Set(filtered.map((r) => r.id)) : new Set())
                          }
                        />
                      </TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                          {loading ? "Loading…" : "No failed sync items match these filters."}
                        </TableCell>
                      </TableRow>
                    )}
                    {filtered.map((r) => (
                      <TableRow key={r.id} className={selected.has(r.id) ? "bg-muted/40" : undefined}>
                        <TableCell>
                          <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-xs">{r.event_type}</div>
                          {r.event_id && (
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">{r.event_id}</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {r.batch_id ? `${r.batch_id.slice(0, 8)}…` : "—"}
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          <div className="text-xs truncate" title={r.error_message}>{r.error_message}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.error_category ?? classifyError(r.error_message)}</Badge>
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {r.retry_count}{r.max_retries ? `/${r.max_retries}` : ""}
                          {r.retry_exhausted && <div className="text-[10px] text-destructive">exhausted</div>}
                        </TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setDetailRow(r)}>
                              Trace
                            </Button>
                            {r.status !== "resolved" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setPendingAction({ action: "retry", ids: [r.id] })}
                                title="Approve and queue another sync attempt"
                              >
                                <RotateCw className="h-4 w-4" />
                              </Button>
                            )}
                            {r.status !== "resolved" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setPendingAction({ action: "resolve", ids: [r.id] })}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DlqItemTraceDialog row={detailRow} onOpenChange={(o) => !o && setDetailRow(null)} />

      <Dialog open={!!pendingAction} onOpenChange={(o) => { if (!o) { setPendingAction(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingAction ? ACTION_META[pendingAction.action].label : ""}</DialogTitle>
            <DialogDescription>
              {pendingAction ? ACTION_META[pendingAction.action].description : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              {pendingAction?.batchId
                ? `Whole batch ${pendingAction.batchId.slice(0, 8)}… — ${pendingAction.ids.length} event(s).`
                : `${pendingAction?.ids.length ?? 0} event(s) selected.`}
            </div>
            <div>
              <Label className="text-xs">
                Reason / operator note {pendingAction?.action === "discard" ? "(required)" : "(optional)"}
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. pos-sync CORS regression fixed and redeployed"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPendingAction(null); setReason(""); }}>
              Cancel
            </Button>
            <Button
              onClick={runAction}
              disabled={working}
              variant={pendingAction && ACTION_META[pendingAction.action].destructive ? "destructive" : "default"}
            >
              {working ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-3xl ${tone === "bad" ? "text-destructive" : ""}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function FilterSelect({
  label, value, onChange, options, short,
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; short?: boolean }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{short ? `${o.slice(0, 8)}…` : o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
