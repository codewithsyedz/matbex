import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { Activity, AlertTriangle, RefreshCw, Snowflake } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Row {
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

const HOT_FUNCTIONS = ["cache-proxy", "terminal-api", "generate-invoice-pdf"];

function ms(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value)} ms`;
}

function errorRate(row: Row): number {
  if (row.invocations === 0) return 0;
  return (row.errors / row.invocations) * 100;
}

export default function AdminEdgeFunctionHealth() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const { data, error } = await (db as any)
        .from("edge_function_health_24h")
        .select("*");
      if (error) throw error;
      // Merge in zero-row entries for hot functions that haven't been hit.
      const byName = new Map<string, Row>(
        ((data as Row[]) ?? []).map((r) => [r.function_name, r]),
      );
      const merged: Row[] = HOT_FUNCTIONS.map((name) =>
        byName.get(name) ?? {
          function_name: name,
          invocations: 0,
          errors: 0,
          cold_starts: 0,
          p50_ms: null, p95_ms: null, p99_ms: null, max_ms: null,
          last_invocation_at: null,
        },
      );
      // Append any non-hot functions that appeared (future-proof).
      for (const r of byName.values()) {
        if (!HOT_FUNCTIONS.includes(r.function_name)) merged.push(r);
      }
      setRows(merged);
    } catch (e) {
      toast.error("Failed to load edge function health: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light tracking-tight">Edge Function Health</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Last 24 hours · sourced from <code className="text-xs">edge_function_metrics</code>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <Activity className="h-4 w-4 text-primary" /> Hot-path functions
          </CardTitle>
          <CardDescription>
            Instrumented via <code>withMetrics()</code>. Error rate &gt; 1% or p95 &gt; 1500ms warrants investigation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Function</TableHead>
                <TableHead className="text-right">Invocations</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Error rate</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">p99</TableHead>
                <TableHead className="text-right">Cold starts</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const rate = errorRate(r);
                const rateBad = rate > 1;
                const p95Bad = (r.p95_ms ?? 0) > 1500;
                return (
                  <TableRow key={r.function_name}>
                    <TableCell className="font-mono text-xs">{r.function_name}</TableCell>
                    <TableCell className="text-right">{r.invocations.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {r.errors > 0 ? (
                        <span className="text-destructive inline-flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />{r.errors}
                        </span>
                      ) : (
                        r.errors
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={rateBad ? "destructive" : "secondary"}>
                        {rate.toFixed(2)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{ms(r.p50_ms)}</TableCell>
                    <TableCell className="text-right">
                      <span className={p95Bad ? "text-destructive font-medium" : ""}>{ms(r.p95_ms)}</span>
                    </TableCell>
                    <TableCell className="text-right">{ms(r.p99_ms)}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Snowflake className="h-3 w-3" />{r.cold_starts}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_invocation_at
                        ? formatDistanceToNow(new Date(r.last_invocation_at), { addSuffix: true })
                        : "never"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                    No metrics yet. New invocations will appear within seconds.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">How this works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Each instrumented edge function calls <code>withMetrics(name, handler)</code> from
            <code> server/functions/_shared/metrics.ts</code>. The wrapper records duration,
            status code, cold-start flag, and any thrown error, then writes one row to
            <code> public.edge_function_metrics</code> via the service role — fire-and-forget,
            so the user response is never delayed.
          </p>
          <p>
            The view <code>edge_function_health_24h</code> aggregates the last 24h.
            Rows older than 14 days are purged by <code>public.purge_edge_function_metrics()</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}