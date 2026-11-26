import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict, format } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleSlash, Clock, Loader2, RefreshCw, XCircle } from "lucide-react";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Health = "ok" | "failing" | "late" | "off" | "never";
interface Job {
  key: string; label: string; about: string | null; featured: boolean; source: string;
  schedule: string | null; timezone: string; enabled: boolean; next_run: string | null; health: Health;
  last_run: string | null; last_status: string | null; last_http_status: number | null; last_summary: string | null; last_duration_ms: number | null;
  last_success: string | null; last_failure: string | null; last_failure_summary: string | null;
  runs_24h: number; failures_24h: number;
}
interface JobsResponse {
  generated_at: string; jobs_enabled: boolean; timezone: string; jobs: Job[];
  deliverect_queue: { pending: number; retrying: number; oldest: string | null; last_error: string | null };
}

async function fetchJobs(): Promise<JobsResponse> {
  const { data, error } = await db.functions.invoke("admin-jobs", { body: {} });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx && typeof ctx.json === "function" ? await ctx.json().then((b: { error?: string }) => b?.error).catch(() => null) : null;
    throw new Error(msg || error.message);
  }
  return data as JobsResponse;
}

/** Status shown with an icon and a word, never colour alone. */
const HEALTH: Record<Health, { label: string; icon: typeof CheckCircle2; className: string }> = {
  ok: { label: "OK", icon: CheckCircle2, className: "text-primary" },
  failing: { label: "Failing", icon: XCircle, className: "text-destructive" },
  late: { label: "Late", icon: AlertTriangle, className: "text-amber-600 dark:text-amber-500" },
  never: { label: "Not run yet", icon: Clock, className: "text-muted-foreground" },
  off: { label: "Off", icon: CircleSlash, className: "text-muted-foreground" },
};

function HealthTag({ h }: { h: Health }) {
  const { label, icon: Icon, className } = HEALTH[h];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium ${className}`}><Icon className="h-4 w-4" />{label}</span>;
}

const ago = (d: string | null) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : "—");
const inTime = (d: string | null) => (d ? `in ${formatDistanceToNowStrict(new Date(d))}` : "—");
const exact = (d: string | null) => (d ? format(new Date(d), "d MMM yyyy, HH:mm:ss") : "");

/** A function's reply is usually a small JSON summary; show it as "key: value" pairs. */
function Summary({ text }: { text: string | null }) {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const parts = Object.entries(v).filter(([, x]) => x === null || ["string", "number", "boolean"].includes(typeof x)).slice(0, 8);
      if (parts.length) return <span className="font-mono text-xs">{parts.map(([k, x]) => `${k}: ${String(x)}`).join(" · ")}</span>;
    }
  } catch { /* plain text */ }
  return <span className="font-mono text-xs break-all">{text.slice(0, 300)}</span>;
}

function FeaturedJob({ j }: { j: Job }) {
  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base font-medium">{j.label}</CardTitle>
          {j.about && <CardDescription className="mt-0.5">{j.about}</CardDescription>}
        </div>
        <HealthTag h={j.health} />
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Last run</span><span title={exact(j.last_run)}>{ago(j.last_run)}{j.last_status ? ` · ${j.last_status}` : ""}</span></div>
        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Next run</span><span title={exact(j.next_run)}>{j.enabled ? inTime(j.next_run) : "off"}</span></div>
        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Last 24 hours</span><span>{j.runs_24h} runs{j.failures_24h ? `, ${j.failures_24h} failed` : ""}</span></div>
        {j.last_summary && <div className="rounded bg-muted/50 px-2 py-1.5 text-muted-foreground"><Summary text={j.last_summary} /></div>}
        {j.last_failure && j.health === "failing" && j.last_failure_summary && (
          <div className="rounded bg-destructive/10 px-2 py-1.5 text-destructive"><Summary text={j.last_failure_summary} /></div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminJobs() {
  const q = useQuery({ queryKey: ["admin-jobs"], queryFn: fetchJobs, refetchInterval: 30_000 });
  const [open, setOpen] = useState<string | null>(null);

  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (q.error || !q.data) return <p className="text-sm text-destructive">{(q.error as Error)?.message ?? "Could not load job status"}</p>;
  const r = q.data;
  const featured = r.jobs.filter((j) => j.featured);
  const counts = r.jobs.reduce((m, j) => ({ ...m, [j.health]: (m[j.health] ?? 0) + 1 }), {} as Record<Health, number>);
  const dq = r.deliverect_queue;

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Scheduled jobs</h1>
          <p>Every background job, when it last ran and how it went. Refreshes every 30 seconds.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${q.isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {!r.jobs_enabled && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          Background jobs are switched off on this server (JOBS_ENABLED=false). Nothing below runs.
        </p>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {(["failing", "late", "never", "ok", "off"] as Health[]).map((h) => (
          <span key={h} className="flex items-center gap-1.5"><HealthTag h={h} /><span className="tabular-nums text-muted-foreground">{counts[h] ?? 0}</span></span>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {featured.map((j) => <FeaturedJob key={j.key} j={j} />)}
        <Card className="border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Deliverect status queue</CardTitle>
            <CardDescription className="mt-0.5">Order status updates waiting to reach Deliverect</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Waiting</span><span className="tabular-nums">{dq.pending}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Being retried</span><span className="tabular-nums">{dq.retrying}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Oldest waiting</span><span>{ago(dq.oldest)}</span></div>
            {dq.last_error && <div className="rounded bg-muted/50 px-2 py-1.5 font-mono text-xs text-muted-foreground break-all">{dq.last_error.slice(0, 200)}</div>}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">All jobs</CardTitle>
          <CardDescription>Problems first. Server schedules run in {r.timezone}; database cron schedules in UTC. Select a row for its last result.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead className="text-right">24h runs / failed</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.jobs.map((j) => (
                <Fragment key={`${j.source}-${j.key}`}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === j.key ? null : j.key)}>
                    <TableCell>
                      <div className="font-medium">{j.label}</div>
                      <div className="text-xs text-muted-foreground">{j.label !== j.key ? `${j.key} · ` : ""}{j.source}</div>
                    </TableCell>
                    <TableCell><HealthTag h={j.health} /></TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{j.schedule ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap" title={exact(j.last_run)}>{ago(j.last_run)}</TableCell>
                    <TableCell className="whitespace-nowrap" title={exact(j.next_run)}>{j.enabled ? inTime(j.next_run) : "off"}</TableCell>
                    <TableCell className="text-right tabular-nums">{j.runs_24h} / {j.failures_24h}</TableCell>
                    <TableCell><ChevronDown className={`h-4 w-4 transition-transform ${open === j.key ? "rotate-180" : ""}`} /></TableCell>
                  </TableRow>
                  {open === j.key && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={7} className="space-y-1 text-sm">
                        {j.about && <p>{j.about}</p>}
                        <p className="text-muted-foreground">
                          Last run {exact(j.last_run) || "never"}{j.last_status ? ` · ${j.last_status}` : ""}
                          {j.last_http_status ? ` · HTTP ${j.last_http_status}` : ""}{j.last_duration_ms != null ? ` · ${j.last_duration_ms} ms` : ""}.
                          {" "}Last success {exact(j.last_success) || "—"}. Last failure {exact(j.last_failure) || "—"}.
                        </p>
                        {j.last_summary && <p><Summary text={j.last_summary} /></p>}
                        {j.last_failure_summary && j.last_failure_summary !== j.last_summary && (
                          <p className="text-destructive"><Summary text={j.last_failure_summary} /></p>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
