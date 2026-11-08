import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { db } from "@/integrations/db/client";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";
import { Stethoscope, RefreshCw, Download, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

type Issue =
  | "not_acked"
  | "ack_without_server_id"
  | "acked_but_sale_missing"
  | "acked_but_in_dlq";

interface LedgerLink {
  batch_id: string | null;
  transaction_id: string;
  transaction_date: string;
  debit: number;
  credit: number;
  is_voided: boolean;
}

interface IssueRow {
  id: string;
  idempotency_key: string;
  entity_type: string;
  terminal_uid: string;
  terminal_name: string | null;
  status: string | null;
  request_id: string | null;
  created_at: string;
  server_id: string | null;
  response: unknown;
  local_record_id: string | null;
  sale_id: string | null;
  receipt_number: string | null;
  sale_total: number | null;
  sale_created_at: string | null;
  ledger_links: LedgerLink[] | null;
  dlq_item_id: string | null;
  dlq_status: string | null;
  dlq_error: string | null;
  dlq_error_category: string | null;
  dlq_batch_id: string | null;
  dlq_retry_exhausted: boolean | null;
  issue: Issue;
}

interface UnackedDlqEvent {
  dlq_item_id: string;
  event_type: string;
  event_id: string | null;
  terminal_id: string | null;
  batch_id: string | null;
  request_id: string | null;
  http_status: number | null;
  error_category: string | null;
  error_message: string;
  retry_count: number;
  retry_exhausted: boolean | null;
  status: string;
  created_at: string;
}

interface Diagnostics {
  branch_id: string;
  window_start: string;
  window_end: string;
  generated_at: string;
  summary: Record<string, number>;
  issues: IssueRow[];
  unacked_dlq_events: UnackedDlqEvent[];
  daily_sales_summary: {
    id: string;
    sales_date: string;
    total_sales: number;
    pos_reported_total: number | null;
    system_calculated_total: number | null;
    variance_amount: number | null;
    variance_status: string | null;
    status: string;
    ledger_posted: boolean;
    ledger_batch_id: string | null;
  } | null;
}

const ISSUE_META: Record<Issue, { label: string; hint: string }> = {
  not_acked: {
    label: "Never acknowledged",
    hint: "The terminal sent the event but the server never wrote a completed acknowledgement — the sale may be missing entirely.",
  },
  ack_without_server_id: {
    label: "Ack without server id",
    hint: "The key was marked completed but carries no server record id, so nothing can be linked to it.",
  },
  acked_but_sale_missing: {
    label: "Acked but sale missing",
    hint: "The acknowledgement points at a sale record that no longer exists (deleted or rolled back).",
  },
  acked_but_in_dlq: {
    label: "Acked but still in DLQ",
    hint: "The server applied the event but the terminal never received the ack, so it is stuck in the dead-letter queue.",
  },
};

function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `﷼ ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function csvEscape(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function PosAckDiagnostics() {
  const { restaurant, hasRole } = useAuth();
  const { branches, activeBranchId } = useBranch();
  const tz = (restaurant as { timezone?: string } | null)?.timezone || "Asia/Riyadh";

  const [branchId, setBranchId] = useState<string>(activeBranchId ?? "");
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [detail, setDetail] = useState<IssueRow | null>(null);
  const [issueFilter, setIssueFilter] = useState<string>("all");

  const canView = hasRole("owner") || hasRole("manager") || hasRole("accountant");

  const bounds = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number);
    return getRestaurantDayBoundsUTC(new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12)), tz);
  }, [date, tz]);

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["pos-ack-diagnostics", branchId, date, tz],
    enabled: !!branchId && canView,
    staleTime: 30_000,
    queryFn: async (): Promise<Diagnostics> => {
      const { data, error } = await (db as any).rpc("pos_ack_diagnostics", {
        _branch_id: branchId,
        _start_utc: bounds.start.toISOString(),
        _end_utc: bounds.endExclusive.toISOString(),
      });
      if (error) throw error;
      return data as Diagnostics;
    },
  });

  const issues = data?.issues ?? [];
  const filteredIssues = issueFilter === "all" ? issues : issues.filter((i) => i.issue === issueFilter);
  const dlqOnly = data?.unacked_dlq_events ?? [];
  const summary = data?.summary ?? {};
  const clean = !!data && issues.length === 0 && dlqOnly.length === 0;

  const exportCsv = () => {
    if (!data) return;
    const headers = [
      "issue","idempotency_key","entity_type","terminal","key_status","created_at","server_id",
      "sale_id","receipt_number","sale_total","ledger_batches","dlq_item_id","dlq_status","dlq_error",
    ];
    const lines = [headers.join(",")];
    for (const r of issues) {
      lines.push([
        r.issue, r.idempotency_key, r.entity_type, r.terminal_name ?? r.terminal_uid, r.status, r.created_at,
        r.server_id, r.sale_id, r.receipt_number, r.sale_total,
        (r.ledger_links ?? []).map((l) => l.batch_id).join(" "),
        r.dlq_item_id, r.dlq_status, r.dlq_error,
      ].map(csvEscape).join(","));
    }
    for (const e of dlqOnly) {
      lines.push([
        "never_reached_server", "", e.event_type, e.terminal_id, e.status, e.created_at,
        "", "", "", "", "", e.dlq_item_id, e.status, e.error_message,
      ].map(csvEscape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pos-ack-diagnostics-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!canView) {
    return (
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <Card><CardContent className="pt-6 text-center text-muted-foreground">
          You do not have permission to view POS acknowledgement diagnostics.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Stethoscope className="h-6 w-6 text-primary" />
            POS Ack Diagnostics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            One click shows every terminal sync key for a branch and business day that never got a clean
            acknowledgement, linked to the sale and ledger records it should have produced.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={!branchId || isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Run diagnostics
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!data}>
            <Download className="h-4 w-4 mr-2" /> CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="Select a branch" /></SelectTrigger>
              <SelectContent>
                {branches.map((b: { id: string; name: string }) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Business day ({tz})</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Issue type</Label>
            <Select value={issueFilter} onValueChange={setIssueFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All issues</SelectItem>
                {(Object.keys(ISSUE_META) as Issue[]).map((k) => (
                  <SelectItem key={k} value={k}>{ISSUE_META[k].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 text-sm text-destructive">
            {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat label="Keys in window" value={summary.total_keys ?? 0} />
            <Stat label="Acknowledged" value={summary.completed ?? 0} />
            <Stat label="Never acked" value={summary.not_acked ?? 0} bad={(summary.not_acked ?? 0) > 0} />
            <Stat label="Sale missing" value={summary.acked_but_sale_missing ?? 0} bad={(summary.acked_but_sale_missing ?? 0) > 0} />
            <Stat label="Never reached server" value={dlqOnly.length} bad={dlqOnly.length > 0} />
          </div>

          {clean && (
            <Card className="border-emerald-600/40">
              <CardContent className="pt-6 text-center space-y-1">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                <div className="text-sm font-medium">All terminal events for this day were acknowledged.</div>
                <div className="text-xs text-muted-foreground">
                  {summary.total_keys ?? 0} keys checked between{" "}
                  {format(new Date(data.window_start), "PPp")} and {format(new Date(data.window_end), "PPp")}.
                </div>
              </CardContent>
            </Card>
          )}

          {data.daily_sales_summary && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Day totals for cross-check</CardTitle>
                <CardDescription>
                  Compare against terminal takings to see whether unacked events explain the variance.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <KV label="Total sales" value={fmtMoney(data.daily_sales_summary.total_sales)} />
                <KV label="POS reported" value={fmtMoney(data.daily_sales_summary.pos_reported_total)} />
                <KV label="System calculated" value={fmtMoney(data.daily_sales_summary.system_calculated_total)} />
                <KV label="Variance" value={fmtMoney(data.daily_sales_summary.variance_amount)} />
                <KV
                  label="Ledger"
                  value={data.daily_sales_summary.ledger_posted ? "Posted" : "Not posted"}
                />
              </CardContent>
            </Card>
          )}

          {filteredIssues.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Keys that failed to ack ({filteredIssues.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[55vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Issue</TableHead>
                        <TableHead>Entity</TableHead>
                        <TableHead>Terminal</TableHead>
                        <TableHead>Sale</TableHead>
                        <TableHead>Ledger</TableHead>
                        <TableHead>DLQ</TableHead>
                        <TableHead className="text-right">Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredIssues.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {format(new Date(r.created_at), "HH:mm:ss")}
                          </TableCell>
                          <TableCell>
                            <Badge variant="destructive">{ISSUE_META[r.issue]?.label ?? r.issue}</Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{r.entity_type}</TableCell>
                          <TableCell className="text-xs">{r.terminal_name ?? r.terminal_uid.slice(0, 8)}</TableCell>
                          <TableCell className="text-xs">
                            {r.sale_id ? (
                              <Link to={`/sales?transaction=${r.sale_id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                                {r.receipt_number ?? r.sale_id.slice(0, 8)} <ExternalLink className="h-3 w-3" />
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">missing</span>
                            )}
                            {r.sale_total != null && <div className="text-muted-foreground">{fmtMoney(r.sale_total)}</div>}
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.ledger_links?.length ? (
                              <Link
                                to={`/accounting/journal?batch=${r.ledger_links[0].batch_id ?? ""}`}
                                className="text-primary hover:underline"
                              >
                                {r.ledger_links.length} line{r.ledger_links.length === 1 ? "" : "s"}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">none</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.dlq_item_id ? (
                              <Link to="/admin/dlq" className="text-primary hover:underline">
                                {r.dlq_status}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>View</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {dlqOnly.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Events that never reached the server ({dlqOnly.length})</CardTitle>
                <CardDescription>
                  Queued on a terminal and failed in transport, so no idempotency key was ever created. Reprocess them
                  from the dead-letter queue.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dlqOnly.map((e) => (
                      <TableRow key={e.dlq_item_id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {format(new Date(e.created_at), "HH:mm:ss")}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {e.event_type}
                          {e.event_id && <div className="text-muted-foreground truncate max-w-[180px]">{e.event_id}</div>}
                        </TableCell>
                        <TableCell className="text-xs max-w-[320px]">
                          <div className="truncate" title={e.error_message}>{e.error_message}</div>
                          {e.error_category && <Badge variant="outline" className="mt-1">{e.error_category}</Badge>}
                        </TableCell>
                        <TableCell className="text-xs">
                          {e.retry_count}{e.retry_exhausted ? " (exhausted)" : ""}
                        </TableCell>
                        <TableCell className="text-xs">{e.status}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" asChild>
                            <Link to="/admin/dlq">Open DLQ</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              {detail ? ISSUE_META[detail.issue]?.label : ""}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <ScrollArea className="max-h-[70vh] pr-2 space-y-4">
              <p className="text-xs text-muted-foreground">{ISSUE_META[detail.issue]?.hint}</p>
              <div className="grid grid-cols-2 gap-2 text-xs mt-3">
                <KV label="Idempotency key" value={detail.idempotency_key} mono />
                <KV label="Key status" value={detail.status ?? "—"} />
                <KV label="Request id" value={detail.request_id ?? "—"} mono />
                <KV label="Server record" value={detail.server_id ?? "—"} mono />
                <KV label="Local record" value={detail.local_record_id ?? "—"} mono />
                <KV label="Terminal" value={detail.terminal_name ?? detail.terminal_uid} />
              </div>
              <div className="mt-4">
                <div className="text-xs font-medium mb-1">Server ack response</div>
                <pre className="rounded border bg-muted/30 p-2 text-[11px] overflow-x-auto">
                  {JSON.stringify(detail.response ?? {}, null, 2)}
                </pre>
              </div>
              <div className="mt-4">
                <div className="text-xs font-medium mb-1">Linked ledger lines</div>
                <pre className="rounded border bg-muted/30 p-2 text-[11px] overflow-x-auto">
                  {JSON.stringify(detail.ledger_links ?? [], null, 2)}
                </pre>
              </div>
              {detail.dlq_item_id && (
                <div className="mt-4 rounded border p-2 text-xs space-y-1">
                  <div className="font-medium">Dead-letter entry</div>
                  <div>{detail.dlq_error}</div>
                  <Button size="sm" variant="outline" asChild className="mt-1">
                    <Link to="/admin/dlq">Open in DLQ</Link>
                  </Button>
                </div>
              )}
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-3xl ${bad ? "text-destructive" : ""}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-[11px] break-all" : "text-sm"}>{value}</div>
    </div>
  );
}
