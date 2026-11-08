import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle, RefreshCw, Search, Monitor, Download, Stethoscope, Zap } from "lucide-react";
import { useTerminalStateRefresh } from "@/hooks/useTerminalStateRefresh";
import { Link } from "react-router-dom";

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";
const STALE_ACK_MS = 60 * 60 * 1000; // 1h without an ack while queue is non-empty = warning

interface TerminalHealthRow {
  terminal_uid: string;
  name: string;
  branch_id: string | null;
  branch_label: string | null;
  active: boolean;
  last_seen_at: string | null;
  last_ack_at: string | null;
  acks_24h: number;
  queue_depth: number;   // open (retryable) DLQ items awaiting resolution
  failed: number;        // discarded / permanently failed
}

function ago(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${format(d, "MMM d, HH:mm")} · ${formatDistanceToNow(d, { addSuffix: true })}`;
}

export default function TerminalSyncHealth() {
  const { restaurant, hasRole } = useAuth();
  const { branches } = useBranch();
  const device = useOfflineStatus();
  const [branchFilter, setBranchFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const refreshState = useTerminalStateRefresh();

  const canView = hasRole("owner") || hasRole("manager") || hasRole("accountant");

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["terminal-sync-health", restaurant?.id],
    enabled: !!restaurant?.id && canView,
    refetchInterval: 60_000,
    queryFn: async () => {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [termRes, ackRes, dlqRes] = await Promise.all([
        supabase
          .from("pos_terminals")
          .select("terminal_uid, name, branch_id, branch_label, active, last_seen_at")
          .eq("restaurant_id", restaurant!.id),
        supabase
          .from("pos_idempotency_keys")
          .select("terminal_uid, created_at, status")
          .eq("restaurant_id", restaurant!.id)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("failed_sync_items")
          .select("terminal_id, branch_id, status, error_message, error_category, created_at, event_type, retry_count")
          .eq("restaurant_id", restaurant!.id)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);
      if (termRes.error) throw termRes.error;
      if (ackRes.error) throw ackRes.error;
      if (dlqRes.error) throw dlqRes.error;

      const lastAck = new Map<string, string>();
      const acks24 = new Map<string, number>();
      for (const a of ackRes.data ?? []) {
        const uid = (a as any).terminal_uid as string | null;
        if (!uid || !a.created_at) continue;
        const prev = lastAck.get(uid);
        if (!prev || new Date(a.created_at) > new Date(prev)) lastAck.set(uid, a.created_at);
        if (a.created_at >= since24h) acks24.set(uid, (acks24.get(uid) ?? 0) + 1);
      }

      const dlq = (dlqRes.data ?? []) as any[];
      const open = new Map<string, number>();
      const failed = new Map<string, number>();
      for (const d of dlq) {
        const uid = (d.terminal_id as string | null) ?? UNASSIGNED;
        if (d.status === "open" || d.status === "retry_requested") {
          open.set(uid, (open.get(uid) ?? 0) + 1);
        } else if (d.status === "discarded" || d.status === "failed") {
          failed.set(uid, (failed.get(uid) ?? 0) + 1);
        }
      }

      const rows: TerminalHealthRow[] = (termRes.data ?? []).map((t: any) => ({
        terminal_uid: t.terminal_uid,
        name: t.name ?? t.terminal_uid,
        branch_id: t.branch_id ?? null,
        branch_label: t.branch_label ?? null,
        active: !!t.active,
        last_seen_at: t.last_seen_at ?? null,
        last_ack_at: lastAck.get(t.terminal_uid) ?? null,
        acks_24h: acks24.get(t.terminal_uid) ?? 0,
        queue_depth: open.get(t.terminal_uid) ?? 0,
        failed: failed.get(t.terminal_uid) ?? 0,
      }));

      // Terminals that only exist in the DLQ (unregistered / retired devices).
      const known = new Set(rows.map((r) => r.terminal_uid));
      for (const uid of new Set([...open.keys(), ...failed.keys()])) {
        if (uid === UNASSIGNED || known.has(uid)) continue;
        const branchId = dlq.find((d) => d.terminal_id === uid)?.branch_id ?? null;
        rows.push({
          terminal_uid: uid,
          name: uid,
          branch_id: branchId,
          branch_label: null,
          active: false,
          last_seen_at: null,
          last_ack_at: lastAck.get(uid) ?? null,
          acks_24h: acks24.get(uid) ?? 0,
          queue_depth: open.get(uid) ?? 0,
          failed: failed.get(uid) ?? 0,
        });
      }

      const unattributed = {
        queue_depth: open.get(UNASSIGNED) ?? 0,
        failed: failed.get(UNASSIGNED) ?? 0,
      };

      const recentFailures = dlq
        .filter((d) => d.status === "open" || d.status === "retry_requested" || d.status === "discarded")
        .slice(0, 25);

      return { rows, unattributed, recentFailures };
    },
  });

  const branchName = (id: string | null) =>
    branches.find((b: any) => b.id === id)?.name ?? (id ? "Unknown branch" : "Unassigned");

  const rows = data?.rows ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => branchFilter === ALL || (r.branch_id ?? UNASSIGNED) === branchFilter)
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.terminal_uid.toLowerCase().includes(q),
      )
      .sort((a, b) => b.queue_depth + b.failed - (a.queue_depth + a.failed));
  }, [rows, branchFilter, search]);

  const byBranch = useMemo(() => {
    const map = new Map<string, { queue: number; failed: number; terminals: number; lastAck: string | null }>();
    for (const r of rows) {
      const key = r.branch_id ?? UNASSIGNED;
      const cur = map.get(key) ?? { queue: 0, failed: 0, terminals: 0, lastAck: null };
      cur.queue += r.queue_depth;
      cur.failed += r.failed;
      cur.terminals += 1;
      if (r.last_ack_at && (!cur.lastAck || new Date(r.last_ack_at) > new Date(cur.lastAck))) {
        cur.lastAck = r.last_ack_at;
      }
      map.set(key, cur);
    }
    return Array.from(map.entries());
  }, [rows]);

  const totals = useMemo(
    () => ({
      queue: rows.reduce((s, r) => s + r.queue_depth, 0) + (data?.unattributed.queue_depth ?? 0),
      failed: rows.reduce((s, r) => s + r.failed, 0) + (data?.unattributed.failed ?? 0),
      terminals: rows.length,
      lastAck: rows.reduce<string | null>(
        (best, r) => (r.last_ack_at && (!best || new Date(r.last_ack_at) > new Date(best)) ? r.last_ack_at : best),
        null,
      ),
    }),
    [rows, data],
  );

  const exportCsv = () => {
    const header = ["Branch", "Terminal", "Terminal UID", "Active", "Last ack", "Acks 24h", "Queue depth", "Failed"];
    const lines = filtered.map((r) =>
      [
        branchName(r.branch_id),
        r.name,
        r.terminal_uid,
        r.active ? "yes" : "no",
        r.last_ack_at ?? "",
        r.acks_24h,
        r.queue_depth,
        r.failed,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terminal-sync-health-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canView) {
    return (
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Not available</CardTitle>
            <CardDescription>Terminal sync health is limited to owners, managers and accountants.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> Terminal Sync Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Queue depth, last successful acknowledgement and failed batches per branch and terminal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/reports/pos-ack-diagnostics">
              <Stethoscope className="h-4 w-4 mr-2" /> Diagnose a day
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              refreshState.mutate({
                branchId: branchFilter === ALL || branchFilter === UNASSIGNED ? null : branchFilter,
                label: branchFilter === ALL || branchFilter === UNASSIGNED ? "all branches" : "selected branch",
              })
            }
            disabled={refreshState.isPending}
            title="Force terminals to reload menu, prices and VAT on their next heartbeat — no shift close needed"
          >
            <Zap className={`h-4 w-4 mr-2 ${refreshState.isPending ? "animate-pulse" : ""}`} /> Refresh terminal state
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Terminals" value={totals.terminals} icon={<Monitor className="h-4 w-4" />} />
        <StatCard label="Queue depth (awaiting sync)" value={totals.queue} tone={totals.queue > 0 ? "warn" : "ok"} />
        <StatCard label="Failed batches" value={totals.failed} tone={totals.failed > 0 ? "bad" : "ok"} />
        <StatCard label="Last successful ack" value={ago(totals.lastAck)} small />
      </div>

      {totals.queue > 0 &&
        totals.lastAck &&
        Date.now() - new Date(totals.lastAck).getTime() > STALE_ACK_MS && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="pt-6 text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
              <span>
                Queued items exist but no terminal has been acknowledged in over an hour — sync may be stalled.
                Check terminal connectivity and the POS sync endpoint.
              </span>
            </CardContent>
          </Card>
        )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Per branch</CardTitle>
          <CardDescription>Aggregated across all terminals paired to each branch.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Terminals</TableHead>
                <TableHead className="text-right">Queue depth</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead>Last ack</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byBranch.map(([id, v]) => (
                <TableRow key={id}>
                  <TableCell className="font-medium">{branchName(id === UNASSIGNED ? null : id)}</TableCell>
                  <TableCell className="text-right">{v.terminals}</TableCell>
                  <TableCell className="text-right">
                    {v.queue > 0 ? <Badge className="bg-amber-500">{v.queue}</Badge> : 0}
                  </TableCell>
                  <TableCell className="text-right">
                    {v.failed > 0 ? <Badge variant="destructive">{v.failed}</Badge> : 0}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{ago(v.lastAck)}</TableCell>
                </TableRow>
              ))}
              {byBranch.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
                    No terminals registered yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {(data?.unattributed.queue_depth || data?.unattributed.failed) ? (
            <p className="text-xs text-muted-foreground mt-3">
              {data.unattributed.queue_depth} queued and {data.unattributed.failed} failed items could not be attributed
              to a terminal.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-medium">Per terminal</CardTitle>
              <CardDescription>Sorted by outstanding work — worst first.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  className="pl-8 w-48"
                  placeholder="Search terminal"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All branches</SelectItem>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Terminal</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Queue depth</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Acks (24h)</TableHead>
                <TableHead>Last successful ack</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.terminal_uid}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.terminal_uid}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.branch_label ?? branchName(r.branch_id)}</TableCell>
                  <TableCell className="text-right">
                    {r.queue_depth > 0 ? <Badge className="bg-amber-500">{r.queue_depth}</Badge> : 0}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.failed > 0 ? <Badge variant="destructive">{r.failed}</Badge> : 0}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.acks_24h}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{ago(r.last_ack_at)}</TableCell>
                  <TableCell>
                    {!r.active ? (
                      <Badge variant="outline">Inactive</Badge>
                    ) : r.failed > 0 ? (
                      <Badge variant="destructive">Needs attention</Badge>
                    ) : r.queue_depth > 0 ? (
                      <Badge className="bg-amber-500">Backlog</Badge>
                    ) : (
                      <Badge variant="secondary">Healthy</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">
                    No terminals match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Recent failed batches</CardTitle>
            <CardDescription>Most recent dead-letter entries across all terminals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.recentFailures ?? []).map((f: any, i: number) => (
              <div key={i} className="rounded-md border p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{f.event_type}</span>
                  <span className="text-muted-foreground">{ago(f.created_at)}</span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground break-all">
                  {f.terminal_id ?? "unknown terminal"} · retries {f.retry_count ?? 0}
                  {f.error_category ? ` · ${f.error_category}` : ""}
                </div>
                <div className="text-destructive break-words">{f.error_message}</div>
              </div>
            ))}
            {(data?.recentFailures ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">No failed batches. </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">This device</CardTitle>
            <CardDescription>Local offline queue on the browser you are using now.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <StatCard label="Connectivity" value={device.status} small />
            <StatCard label="Pending" value={device.pending} tone={device.pending ? "warn" : "ok"} />
            <StatCard label="Failed" value={device.failed} tone={device.failed ? "bad" : "ok"} />
            <StatCard label="Last synced" value={ago(device.lastSyncedAt)} small />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
  small,
  icon,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "ok" | "warn" | "bad";
  small?: boolean;
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
        <div className={`${small ? "text-sm" : "text-2xl"} font-light mt-1 ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}