import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, CircleSlash, HeartPulse, Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { healthScore, type HealthLevel, type HealthSignals } from "@/lib/admin/healthScore";
import { planLabel } from "@/lib/billing/planLabel";

/** Level shown with an icon and a word, never colour alone. */
const LEVEL: Record<HealthLevel, { label: string; icon: typeof HeartPulse; text: string; bar: string }> = {
  at_risk: { label: "At risk", icon: ShieldAlert, text: "text-destructive", bar: "bg-destructive" },
  watch: { label: "Watch", icon: AlertTriangle, text: "text-amber-600 dark:text-amber-500", bar: "bg-amber-500" },
  healthy: { label: "Healthy", icon: HeartPulse, text: "text-primary", bar: "bg-primary" },
  suspended: { label: "Suspended", icon: CircleSlash, text: "text-muted-foreground", bar: "bg-muted-foreground" },
};
const ORDER: HealthLevel[] = ["at_risk", "watch", "healthy", "suspended"];

const sar = (n: number) => `SAR ${Math.round(n).toLocaleString("en-US")}`;
const ago = (d: string | null) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : "never");

export default function AdminCustomerHealth() {
  const [filter, setFilter] = useState<HealthLevel | "all">("all");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["admin-tenant-health"],
    queryFn: async () => {
      const { data, error } = await db.rpc("admin_tenant_health");
      if (error) throw error;
      return (data ?? []) as HealthSignals[];
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const now = Date.now();
    return (q.data ?? [])
      .map((s) => ({ s, h: healthScore(s, now) }))
      .sort((a, b) => ORDER.indexOf(a.h.level) - ORDER.indexOf(b.h.level) || (a.h.score ?? 101) - (b.h.score ?? 101));
  }, [q.data]);
  const counts = rows.reduce((m, r) => ({ ...m, [r.h.level]: (m[r.h.level] ?? 0) + 1 }), {} as Record<HealthLevel, number>);
  const shown = rows.filter((r) => (filter === "all" || r.h.level === filter) && r.s.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Customer health</h1>
          <p>Which businesses are thriving and which may leave: sign-ins, sales trend, billing and setup, scored 0–100.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${q.isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {ORDER.map((l) => {
          const { label, icon: Icon, text } = LEVEL[l];
          const active = filter === l;
          return (
            <button key={l} type="button" onClick={() => setFilter(active ? "all" : l)}
              className={`rounded-lg border bg-card p-4 text-start transition-colors hover:bg-muted/50 ${active ? "ring-2 ring-primary" : "border-border/40"}`}>
              <span className={`flex items-center gap-1.5 text-xs font-medium ${text}`}><Icon className="h-4 w-4" />{label}</span>
              <span className="mt-1 block text-2xl font-semibold tabular-nums">{counts[l] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <Card className="border-border/40">
        <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base font-medium">Businesses</CardTitle>
            <CardDescription>
              Lowest score first{filter !== "all" ? ` · showing ${LEVEL[filter].label.toLowerCase()} only` : ""}. Score: sign-ins 30, sales 35, billing 20, setup 15.
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search businesses…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
        </CardHeader>
        <CardContent>
          {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : q.error ? (
            <p className="text-sm text-destructive">{(q.error as Error).message}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead className="w-40">Score</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead className="text-right">Sales, 7 days</TableHead>
                  <TableHead className="text-right">Revenue, 30 days</TableHead>
                  <TableHead className="text-right">Setup</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(({ s, h }) => {
                  const look = LEVEL[h.level];
                  const Icon = look.icon;
                  const weekly = Math.round(s.sales_prev_28d / 4);
                  return (
                    <TableRow key={s.tenant_id} className="align-top">
                      <TableCell>
                        <Link to={`/admin/tenants/${s.tenant_id}`} className="font-medium hover:underline">{s.name}</Link>
                        <div className="text-xs text-muted-foreground">{planLabel(s.plan)} · {s.status.replace("_", " ")}</div>
                      </TableCell>
                      <TableCell>
                        <div className={`flex items-center gap-1.5 text-sm font-medium ${look.text}`}>
                          <Icon className="h-4 w-4" />{h.score ?? "—"}<span className="font-normal">{look.label}</span>
                        </div>
                        {h.score != null && (
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                            <div className={`h-full rounded-full ${look.bar}`} style={{ width: `${h.score}%` }} />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm">
                        {h.reasons.length ? (
                          <ul className="space-y-0.5">{h.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}</ul>
                        ) : <span className="text-muted-foreground">All good</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{ago(s.last_login_at)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.sales_7d}
                        <div className="text-xs text-muted-foreground">{weekly ? `avg ${weekly}/week before` : "no history"}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{sar(Number(s.revenue_30d))}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.setup_done}/{s.setup_total}</TableCell>
                    </TableRow>
                  );
                })}
                {shown.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No businesses match.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
