import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { AlertTriangle, CheckCircle2, Download, Scale, ChevronDown, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useOverheadReconciliation, type ReconRow, type ReconStatus } from "@/hooks/useOverheadReconciliation";

const STATUS_META: Record<ReconStatus, { label: string; className: string }> = {
  matched: { label: "Matched", className: "bg-primary/15 text-primary" },
  unposted: { label: "Not posted", className: "bg-muted text-muted-foreground" },
  missing_gl: { label: "Missing GL", className: "bg-destructive/15 text-destructive" },
  amount_mismatch: { label: "Amount mismatch", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  unbalanced: { label: "Unbalanced", className: "bg-destructive/15 text-destructive" },
  voided: { label: "Voided", className: "bg-muted text-muted-foreground" },
};

export default function OverheadReconciliation() {
  const { tenant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();

  const [periodStart, setPeriodStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [periodEnd, setPeriodEnd] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const { data, isLoading } = useOverheadReconciliation({ branchId, periodStart, periodEnd });
  const rows = data?.rows ?? [];
  const orphans = data?.orphans ?? [];
  const totals = data?.totals;

  const branchLabel = useMemo(
    () => (!branchId || branchId === "all" ? "All branches" : branches.find(b => b.id === branchId)?.name ?? branchId),
    [branchId, branches],
  );

  const visible = onlyIssues ? rows.filter(r => r.reconStatus !== "matched") : rows;

  const handleExport = () => {
    const lines: string[] = [];
    lines.push(`Daily Overhead Reconciliation,${tenant?.name ?? ""}`);
    lines.push(`Period,${periodStart} to ${periodEnd}`);
    lines.push(`Branch,${branchLabel}`);
    lines.push("");
    lines.push([
      "Date", "Branch", "GL Reference", "Closure Status", "Allocated", "GL Debit", "GL Credit",
      "Expense Debit", "Accrual Credit", "Difference", "Reconciliation", "Issues",
    ].join(","));
    for (const r of visible) {
      lines.push([
        r.business_date,
        `"${r.branch_name.replace(/"/g, '""')}"`,
        r.gl_reference,
        r.status,
        r.allocated.toFixed(2),
        r.glDebit.toFixed(2),
        r.glCredit.toFixed(2),
        r.expenseDebit.toFixed(2),
        r.accrualCredit.toFixed(2),
        r.difference.toFixed(2),
        STATUS_META[r.reconStatus].label,
        `"${r.issues.join("; ").replace(/"/g, '""')}"`,
      ].join(","));
    }
    if (totals) {
      lines.push([
        "TOTAL", "", "", "",
        totals.allocated.toFixed(2), totals.glDebit.toFixed(2), totals.glCredit.toFixed(2),
        totals.expenseDebit.toFixed(2), totals.accrualCredit.toFixed(2),
        (totals.allocated - totals.glDebit).toFixed(2), "", "",
      ].join(","));
    }
    if (orphans.length) {
      lines.push("");
      lines.push("Unmatched GL lines (no closure in period)");
      lines.push(["Date", "Batch", "Closure Ref", "Debit", "Credit", "Description"].join(","));
      for (const o of orphans) {
        lines.push([
          o.transaction_date, o.batch_id ?? "", o.reference_id ?? "",
          o.debit.toFixed(2), o.credit.toFixed(2),
          `"${(o.description ?? "").replace(/"/g, '""')}"`,
        ].join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `overhead-reconciliation-${periodStart}-${periodEnd}${branchId !== "all" ? `-${branchLabel.replace(/\s+/g, "_")}` : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Reconciliation exported");
  };

  const headlineDiff = totals ? Math.round((totals.allocated - totals.glDebit) * 100) / 100 : 0;

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Overhead Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compares finalized Daily Overhead allocations against the expense and accrual entries in the general ledger.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport} disabled={!rows.length}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Branch</Label>
            <Select value={branchId} onValueChange={setBranchId} disabled={!!pinnedBranchId}>
              <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant={onlyIssues ? "default" : "outline"}
            size="sm"
            className="h-9"
            onClick={() => setOnlyIssues(v => !v)}
          >
            {onlyIssues ? "Showing discrepancies" : "Show discrepancies only"}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Allocated (closures)" value={fmt(totals?.allocated ?? 0)} sub={`${totals?.days ?? 0} day(s)`} />
            <SummaryCard label="GL expense debit" value={fmt(totals?.expenseDebit ?? 0)} sub={`Total DR ${fmt(totals?.glDebit ?? 0)}`} />
            <SummaryCard label="GL accrual credit" value={fmt(totals?.accrualCredit ?? 0)} sub={`Total CR ${fmt(totals?.glCredit ?? 0)}`} />
            <SummaryCard
              label="Difference"
              value={fmt(headlineDiff)}
              sub={`${totals?.discrepancies ?? 0} day(s) flagged`}
              tone={Math.abs(headlineDiff) > 0.009 || (totals?.discrepancies ?? 0) > 0 ? "bad" : "good"}
            />
          </div>

          {(totals?.discrepancies ?? 0) === 0 && !orphans.length ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <AlertTitle>Fully reconciled</AlertTitle>
              <AlertDescription>
                Every overhead allocation in this period has a balanced, matching ledger entry.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{(totals?.discrepancies ?? 0) + orphans.length} item(s) need attention</AlertTitle>
              <AlertDescription>
                Expand a row to see the ledger lines behind it, or open Daily Overhead Closing to post/adjust the day.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Day-by-day comparison</CardTitle>
              <CardDescription>{branchLabel} · {periodStart} → {periodEnd}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Allocated</TableHead>
                    <TableHead className="text-right">Expense DR</TableHead>
                    <TableHead className="text-right">Accrual CR</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                        No overhead closures in this period.
                      </TableCell>
                    </TableRow>
                  )}
                  {visible.map(r => (
                    <RowBlock
                      key={r.closure_id}
                      row={r}
                      open={openRow === r.closure_id}
                      onToggle={() => setOpenRow(openRow === r.closure_id ? null : r.closure_id)}
                      fmt={fmt}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {orphans.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Unmatched ledger lines</CardTitle>
                <CardDescription>
                  Overhead-tagged GL lines in this period with no corresponding closure record.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orphans.map((o, i) => (
                      <TableRow key={`${o.batch_id}-${i}`}>
                        <TableCell>{o.transaction_date}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{o.description ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(o.debit)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(o.credit)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-light tabular-nums ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-primary" : ""}`}>
          {value}
        </p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function RowBlock({
  row, open, onToggle, fmt,
}: { row: ReconRow; open: boolean; onToggle: () => void; fmt: (n: number) => string }) {
  const meta = STATUS_META[row.reconStatus];
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="font-medium">{row.business_date}</TableCell>
        <TableCell className="text-sm text-muted-foreground">{row.branch_name}</TableCell>
        <TableCell className="font-mono text-xs">{row.gl_reference}</TableCell>
        <TableCell className="text-right tabular-nums">{fmt(row.allocated)}</TableCell>
        <TableCell className="text-right tabular-nums">{fmt(row.expenseDebit)}</TableCell>
        <TableCell className="text-right tabular-nums">{fmt(row.accrualCredit)}</TableCell>
        <TableCell className={`text-right tabular-nums ${Math.abs(row.difference) > 0.009 ? "text-destructive" : ""}`}>
          {fmt(row.difference)}
        </TableCell>
        <TableCell><Badge variant="outline" className={meta.className}>{meta.label}</Badge></TableCell>
        <TableCell>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={9} className="bg-muted/30">
            <div className="space-y-3 py-2">
              {row.issues.length > 0 && (
                <ul className="space-y-1 text-sm text-destructive">
                  {row.issues.map((i, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {i}
                    </li>
                  ))}
                </ul>
              )}
              {row.lines.length > 0 ? (
                <div className="rounded-md border bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {row.lines.map((l, idx) => (
                        <TableRow key={idx} className={l.is_voided ? "opacity-50 line-through" : ""}>
                          <TableCell className="text-sm">{l.code} · {l.name}</TableCell>
                          <TableCell className="text-xs uppercase text-muted-foreground">{l.type}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(l.debit)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(l.credit)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No ledger lines recorded for this day.</p>
              )}
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link to={`/accounting/daily-overhead?date=${row.business_date}${row.branch_id ? `&branch=${row.branch_id}` : ""}`}>
                  <ExternalLink className="h-3.5 w-3.5" /> Open Daily Overhead Closing
                </Link>
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
