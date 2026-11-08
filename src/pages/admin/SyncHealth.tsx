import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/integrations/db/client";
import { getMetricsSnapshot, summarizeLatency, type SyncMetricsSnapshot } from "@/lib/offline/metrics";
import { getQueueSnapshot } from "@/lib/offline/syncEngine";
import { Activity, RefreshCw, Snowflake, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface HealthRow {
  function_name: string;
  invocations: number;
  errors: number;
  cold_starts: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
  last_invocation_at: string | null;
}

const TRACKED = ["pos-sync", "terminal-api"];

function ms(v: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v)} ms`;
}

function errorRate(row: HealthRow): number {
  if (row.invocations === 0) return 0;
  return (row.errors / row.invocations) * 100;
}

function errorBadge(rate: number) {
  if (rate === 0) return <Badge variant="secondary">0%</Badge>;
  if (rate < 1) return <Badge variant="outline">{rate.toFixed(2)}%</Badge>;
  if (rate < 5) return <Badge className="bg-amber-500">{rate.toFixed(1)}%</Badge>;
  return <Badge variant="destructive">{rate.toFixed(1)}%</Badge>;
}

export default function SyncHealth() {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [metrics, setMetrics] = useState<SyncMetricsSnapshot | null>(null);
  const [failedTop, setFailedTop] = useState<{ error: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data, error }, snap, queue] = await Promise.all([
        (db as any).from("sync_health_v1").select("*"),
        getMetricsSnapshot(),
        getQueueSnapshot(),
      ]);
      if (error) throw error;
      const byName = new Map<string, HealthRow>(((data as HealthRow[]) ?? []).map((r) => [r.function_name, r]));
      const merged: HealthRow[] = TRACKED.map(
        (name) =>
          byName.get(name) ?? {
            function_name: name,
            invocations: 0,
            errors: 0,
            cold_starts: 0,
            p50_ms: null,
            p95_ms: null,
            p99_ms: null,
            max_ms: null,
            last_invocation_at: null,
          },
      );
      setRows(merged);
      setMetrics(snap);
      // Top error categories from local queue
      const buckets = new Map<string, number>();
      for (const q of queue) {
        if ((q.status === "FAILED" || q.status === "FAILED_VALIDATION") && q.error_message) {
          const key = q.error_message.slice(0, 120);
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
      }
      setFailedTop(
        Array.from(buckets.entries())
          .map(([error, count]) => ({ error, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
      );
    } catch (e) {
      toast.error("Failed to load sync health: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const latency = metrics ? summarizeLatency(metrics.latency_ms_samples) : null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-6 w-6" /> Sync Health
          </h1>
          <p className="text-sm text-muted-foreground">
            Rolling 24h aggregates for the POS sync endpoints plus this device's local queue.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cloud sync endpoints (24h)</CardTitle>
          <CardDescription>Aggregated from edge_function_metrics via sync_health_v1.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Function</TableHead>
                <TableHead className="text-right">Invocations</TableHead>
                <TableHead className="text-right">Error rate</TableHead>
                <TableHead className="text-right">Cold starts</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">p99</TableHead>
                <TableHead className="text-right">Last hit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.function_name}>
                  <TableCell className="font-mono text-sm">{r.function_name}</TableCell>
                  <TableCell className="text-right">{r.invocations.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{errorBadge(errorRate(r))}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <Snowflake className="h-3 w-3 text-muted-foreground" />
                      {r.cold_starts}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{ms(r.p50_ms)}</TableCell>
                  <TableCell className="text-right">{ms(r.p95_ms)}</TableCell>
                  <TableCell className="text-right">{ms(r.p99_ms)}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {r.last_invocation_at ? formatDistanceToNow(new Date(r.last_invocation_at), { addSuffix: true }) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>This device</CardTitle>
            <CardDescription>Local IndexedDB queue + client-side sync counters.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Queue depth" value={metrics?.queue_depth ?? 0} />
              <Stat label="Failed items" value={metrics?.failed_depth ?? 0} tone={metrics?.failed_depth ? "bad" : "ok"} />
              <Stat label="Events synced" value={metrics?.sync_success ?? 0} />
              <Stat label="Events failed" value={metrics?.sync_failed ?? 0} tone={metrics?.sync_failed ? "bad" : "ok"} />
              <Stat label="Batches sent" value={metrics?.batches_sent ?? 0} />
              <Stat label="Latency samples" value={latency?.count ?? 0} />
            </div>
            {latency && latency.count > 0 && (
              <div className="grid grid-cols-4 gap-2 pt-2 border-t">
                <Stat label="p50" value={ms(latency.p50)} small />
                <Stat label="p95" value={ms(latency.p95)} small />
                <Stat label="p99" value={ms(latency.p99)} small />
                <Stat label="max" value={ms(latency.max)} small />
              </div>
            )}
            <div className="text-xs text-muted-foreground pt-2 border-t">
              Last success:{" "}
              {metrics?.last_success_at
                ? formatDistanceToNow(new Date(metrics.last_success_at), { addSuffix: true })
                : "never"}
              {metrics?.last_error && (
                <div className="text-destructive mt-1 flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span className="break-all">{metrics.last_error}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top error categories</CardTitle>
            <CardDescription>Failed queue items on this device, grouped by message.</CardDescription>
          </CardHeader>
          <CardContent>
            {failedTop.length === 0 ? (
              <p className="text-sm text-muted-foreground">No failed items — queue is clean.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {failedTop.map((f) => (
                  <li key={f.error} className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0">
                    <span className="text-xs font-mono text-muted-foreground break-all">{f.error}</span>
                    <Badge variant="destructive" className="flex-shrink-0">{f.count}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: number | string;
  tone?: "ok" | "bad";
  small?: boolean;
}) {
  return (
    <div>
      <div className={`text-xs uppercase tracking-wide text-muted-foreground ${small ? "" : ""}`}>{label}</div>
      <div
        className={`${small ? "text-lg" : "text-2xl"} font-semibold ${
          tone === "bad" && value !== 0 ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}