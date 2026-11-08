import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useSalePostingMonitor } from "@/hooks/useSalePostingMonitor";
import { AlertTriangle, Activity, CheckCircle2, RefreshCw, Repeat, Download } from "lucide-react";

const ALL = "__all__";

function ymd(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export default function SalePostingMonitor() {
  const { hasRole } = useAuth();
  const { branches, activeBranchId } = useBranch();
  const [from, setFrom] = useState(ymd(subDays(new Date(), 7)));
  const [to, setTo] = useState(ymd(new Date()));
  const [branchFilter, setBranchFilter] = useState<string>(activeBranchId ?? ALL);
  const [showResolved, setShowResolved] = useState(false);

  const canView = hasRole("owner") || hasRole("manager") || hasRole("accountant");

  const branchId = branchFilter === ALL ? null : branchFilter;
  const { stats, failures, replays, isFetching, refetch, resolve } = useSalePostingMonitor({
    from,
    to,
    branchId,
  });

  const branchName = (id: string | null) =>
    branches.find((b) => b.id === id)?.name ?? (id ? "Unknown branch" : "—");

  const visibleFailures = useMemo(
    () => failures.filter((f) => (showResolved ? true : !f.resolved_at)),
    [failures, showResolved],
  );

  const affectedShifts = stats?.affected_shift_ids ?? [];

  const exportCsv = () => {
    const rows = [
      ["Date", "Branch", "Source", "Shift ID", "Error code", "Error", "Resolved at"],
      ...visibleFailures.map((f) => [
        f.business_date,
        branchName(f.branch_id),
        f.source,
        f.shift_id ?? "",
        f.error_code ?? "",
        (f.error_message ?? "").replace(/"/g, "'"),
        f.resolved_at ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sale-posting-failures-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canView) {
    return (
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Sale Posting Monitor</CardTitle>
            <CardDescription>
              You need owner, manager or accountant access to view posting health.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Sale Posting Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sale-to-ledger posting failures, idempotency replays and affected shifts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant={showResolved ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? "Hiding nothing" : "Show resolved"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Unresolved failures"
          value={stats?.failures_unresolved ?? 0}
          tone={(stats?.failures_unresolved ?? 0) > 0 ? "danger" : "ok"}
          icon={AlertTriangle}
        />
        <StatCard label="Total failures" value={stats?.failures_total ?? 0} icon={Activity} />
        <StatCard
          label="Unposted closed days"
          value={stats?.unposted_closed_days ?? 0}
          tone={(stats?.unposted_closed_days ?? 0) > 0 ? "warn" : "ok"}
          icon={AlertTriangle}
        />
        <StatCard
          label="Idempotency replays"
          value={stats?.idempotency_replays ?? 0}
          icon={Repeat}
          hint={`${stats?.idempotency_replayed_keys ?? 0} keys replayed`}
        />
        <StatCard label="Affected shifts" value={affectedShifts.length} icon={Activity} />
      </div>

      <Tabs defaultValue="failures">
        <TabsList>
          <TabsTrigger value="failures">Failures ({visibleFailures.length})</TabsTrigger>
          <TabsTrigger value="replays">Replays ({replays.length})</TabsTrigger>
          <TabsTrigger value="shifts">Affected shifts ({affectedShifts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="failures">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Sale-to-ledger posting failures</CardTitle>
              <CardDescription>
                Every failed posting attempt, with the branch, shift and the exact database error.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleFailures.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                        No posting failures in this window.
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleFailures.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="whitespace-nowrap">{f.business_date}</TableCell>
                      <TableCell>{branchName(f.branch_id)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{f.source}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {f.shift_id ? f.shift_id.slice(0, 8) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <div className="text-sm">{f.error_message}</div>
                        {f.error_code && (
                          <div className="text-xs text-muted-foreground font-mono">{f.error_code}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {f.resolved_at ? (
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Resolved
                          </Badge>
                        ) : (
                          <Badge variant="destructive">Open</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!f.resolved_at && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => resolve.mutate(f.id)}
                            disabled={resolve.isPending}
                          >
                            Resolve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="replays">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Idempotency replays</CardTitle>
              <CardDescription>
                Terminal batches re-sent with a key already processed. High counts mean acks are not
                reaching the device.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Idempotency key</TableHead>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead className="text-right">Replays</TableHead>
                    <TableHead>Last replay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {replays.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                        No replays recorded in this window.
                      </TableCell>
                    </TableRow>
                  )}
                  {replays.map((r) => (
                    <TableRow key={r.idempotency_key}>
                      <TableCell className="font-mono text-xs">{r.idempotency_key}</TableCell>
                      <TableCell className="font-mono text-xs">{r.terminal_uid}</TableCell>
                      <TableCell>{r.entity_type}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.shift_id ? r.shift_id.slice(0, 8) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">{r.replay_count}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {r.last_replay_at ? format(new Date(r.last_replay_at), "MMM d, HH:mm") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shifts">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Affected shift IDs</CardTitle>
              <CardDescription>
                Shifts touched by a posting failure or a replayed sync key in this window.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {affectedShifts.length === 0 && (
                <p className="text-sm text-muted-foreground">No affected shifts.</p>
              )}
              {affectedShifts.map((id) => (
                <Badge key={id} variant="outline" className="font-mono text-xs">
                  {id}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "ok" | "warn" | "danger";
  hint?: string;
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-500"
        : tone === "ok"
          ? "text-primary"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${toneClass}`} />
        </div>
        <div className={`text-2xl font-light mt-2 ${toneClass}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}
