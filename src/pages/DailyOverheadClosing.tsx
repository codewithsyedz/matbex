import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, startOfMonth, endOfMonth, subDays } from "date-fns";
import {
  CheckCircle2, Lock, AlertTriangle, RefreshCw, Download, History,
  CalendarDays, FileText, Unlock, PencilLine,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import { useCurrency } from "@/hooks/useCurrency";
import { useBranch } from "@/contexts/BranchContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useOverheadData } from "@/hooks/useOverheadData";
import { useDailyOverhead, type DailyOverheadClosure, type DailyOverheadStatus } from "@/hooks/useDailyOverhead";
import OverheadDayBreakdown from "@/components/accounting/OverheadDayBreakdown";

const STATUS_META: Record<DailyOverheadStatus | "unopened", { label: string; className: string }> = {
  unopened: { label: "Open Day", className: "bg-muted text-muted-foreground" },
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  reopened: { label: "Reopened", className: "bg-muted text-muted-foreground" },
  finalized: { label: "Finalized", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  posting_failed: { label: "GL Posting Failed", className: "bg-destructive/15 text-destructive" },
  posted: { label: "Posted", className: "bg-primary/15 text-primary" },
  adjusted: { label: "Adjusted", className: "bg-primary/15 text-primary" },
};

function StatusBadge({ status }: { status: DailyOverheadStatus | "unopened" }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return <Badge variant="outline" className={meta.className}>{meta.label}</Badge>;
}

export default function DailyOverheadClosing() {
  const { format: formatCurrency } = useCurrency();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const { isOwner, isManager, isAccountant } = usePermissions();
  const canManage = isOwner || isManager || isAccountant;

  const branchId = pinnedBranchId ?? activeBranchId ?? null;

  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get("date");
  const [businessDate, setBusinessDate] = useState(
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : format(subDays(new Date(), 1), "yyyy-MM-dd")
  );
  const [periodStart, setPeriodStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [periodEnd, setPeriodEnd] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const { data: overheadData, isLoading: overheadLoading } = useOverheadData();
  const suggested = Number(overheadData?.dailyOverhead ?? 0);

  const { closure, period, audit, finalizeDay, retryPosting, reopenDay, adjustDay } =
    useDailyOverhead({ branchId, businessDate, periodStart, periodEnd });

  const row: DailyOverheadClosure | null = closure.data ?? null;
  const status: DailyOverheadStatus | "unopened" = row?.status ?? "unopened";
  const isLocked = !!row && ["finalized", "posted", "posting_failed", "adjusted"].includes(row.status);

  const [draftAmount, setDraftAmount] = useState<string>("");
  const effectiveAmount = isLocked
    ? Number(row?.overhead_amount ?? 0)
    : draftAmount !== "" ? Number(draftAmount) : suggested;

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  /** Mirrors the reference the database generates on finalize. */
  const previewReference = useMemo(() => {
    const suffix = branchId ? `-${branchId.replace(/-/g, "").slice(0, 6).toUpperCase()}` : "";
    return `OH-${businessDate.replace(/-/g, "")}${suffix}`;
  }, [branchId, businessDate]);

  const totals = useMemo(() => {
    const rows = period.data ?? [];
    const posted = rows.filter(r => r.status === "posted" || r.status === "adjusted");
    const unposted = rows.filter(r => !["posted", "adjusted"].includes(r.status));
    const sum = (list: DailyOverheadClosure[]) =>
      list.reduce((s, r) => s + Number(r.overhead_amount || 0), 0);
    return {
      total: sum(rows),
      posted: sum(posted),
      unposted: sum(unposted),
      adjustedCount: rows.filter(r => r.status === "adjusted").length,
      failedCount: rows.filter(r => r.status === "posting_failed").length,
      count: rows.length,
    };
  }, [period.data]);

  const handleFinalize = async () => {
    if (!Number.isFinite(effectiveAmount) || effectiveAmount < 0) {
      toast.error("Enter a valid overhead amount");
      return;
    }
    try {
      await finalizeDay.mutateAsync({
        amount: Number(effectiveAmount.toFixed(2)),
        breakdown: {
          fixed_overhead: overheadData?.fixedOverhead ?? null,
          payroll_payable: overheadData?.totalPayable ?? null,
          days_in_period: overheadData?.totalDays ?? null,
          source: draftAmount !== "" ? "manual_override" : "calculated",
        },
      });
      toast.success(`Day ${businessDate} finalized and posted`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to finalize the day");
    }
  };

  const handleRetry = async () => {
    if (!row) return;
    try {
      await retryPosting.mutateAsync(row.id);
      toast.success("GL posting completed");
    } catch (e: any) {
      toast.error(e?.message ?? "GL posting failed again");
    }
  };

  const handleReopen = async () => {
    if (!row) return;
    try {
      await reopenDay.mutateAsync({ closureId: row.id, reason: reopenReason });
      setReopenOpen(false);
      setReopenReason("");
      toast.success("Day reopened for review");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reopen the day");
    }
  };

  const handleAdjust = async () => {
    if (!row) return;
    try {
      await adjustDay.mutateAsync({
        closureId: row.id,
        newAmount: Number(adjustAmount),
        reason: adjustReason,
      });
      setAdjustOpen(false);
      setAdjustAmount("");
      setAdjustReason("");
      toast.success("Adjustment posted (original entry reversed)");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not post the adjustment");
    }
  };

  const exportCsv = () => {
    const rows = period.data ?? [];
    const header = [
      "Business Date", "Overhead Amount", "Status", "GL Reference",
      "GL Posting Date", "Original Amount", "Posting Error",
    ];
    const body = rows.map(r => [
      r.business_date,
      Number(r.overhead_amount).toFixed(2),
      STATUS_META[r.status]?.label ?? r.status,
      r.gl_reference,
      r.posted_at ? format(new Date(r.posted_at), "yyyy-MM-dd HH:mm") : "",
      r.original_amount != null ? Number(r.original_amount).toFixed(2) : "",
      (r.posting_error ?? "").replace(/[\r\n,]+/g, " "),
    ]);
    const csv = [header, ...body].map(cols => cols.map(c => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-overhead-${periodStart}_${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Daily Overhead Closing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review the day&apos;s overhead, finalize it, and post it automatically to the General Ledger.
        </p>
      </header>

      {!canManage && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>
            Only finance roles (owner, manager, accountant) can finalize, adjust, or reverse daily overhead.
          </AlertDescription>
        </Alert>
      )}

      {/* Workflow strip */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {["Open Day", "Review Overhead / Day", "Finalize Day", "Lock Overhead", "Post to GL", "Posted"].map((step, i, arr) => (
            <span key={step} className="flex items-center gap-2">
              <span className={i <= (status === "posted" || status === "adjusted" ? 5 : isLocked ? 3 : 1) ? "font-medium text-foreground" : ""}>
                {step}
              </span>
              {i < arr.length - 1 && <span aria-hidden>→</span>}
            </span>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Day panel */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
            <div>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Business Day
              </CardTitle>
              <CardDescription>
                {branchId ? "Scoped to the active branch" : "Consolidated (no branch scope)"}
              </CardDescription>
            </div>
            <StatusBadge status={status} />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="business-date">Business date</Label>
                <Input
                  id="business-date"
                  type="date"
                  value={businessDate}
                  max={format(new Date(), "yyyy-MM-dd")}
                  onChange={e => { setBusinessDate(e.target.value); setDraftAmount(""); }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="overhead-amount" className="flex items-center gap-2">
                  Overhead / Day
                  {isLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                </Label>
                <Input
                  id="overhead-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={isLocked || !canManage}
                  value={isLocked ? Number(row?.overhead_amount ?? 0).toFixed(2) : draftAmount !== "" ? draftAmount : suggested.toFixed(2)}
                  onChange={e => setDraftAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {isLocked
                    ? "Locked — finalized values are read-only. Use an adjustment to correct."
                    : overheadLoading
                      ? "Calculating suggested overhead…"
                      : `Calculated: ${formatCurrency(suggested)} / day`}
                </p>
              </div>
            </div>

            {closure.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <OverheadDayBreakdown effectiveAmount={effectiveAmount} isLocked={isLocked} />
            )}

            {closure.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">GL Reference</p>
                  <p className="font-mono">{row?.gl_reference ?? previewReference}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">GL Posting Date</p>
                  <p>{row?.posted_at ? format(new Date(row.posted_at), "dd MMM yyyy HH:mm") : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Finalized</p>
                  <p>{row?.finalized_at ? format(new Date(row.finalized_at), "dd MMM yyyy HH:mm") : "Not finalized"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Accounting entry</p>
                  <p className="text-xs">DR Daily Overhead Expense · CR Accrued Overhead</p>
                </div>
              </div>
            )}

            {row?.status === "posting_failed" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>GL posting failed</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p className="text-xs">{row.posting_error ?? "Unknown error"}</p>
                  <p className="text-xs">The day stays finalized and locked. Retry is idempotent.</p>
                </AlertDescription>
              </Alert>
            )}

            {(row?.status === "posted" || row?.status === "adjusted") && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Posted to the General Ledger</AlertTitle>
                <AlertDescription className="text-xs">
                  {formatCurrency(Number(row.overhead_amount))} posted under reference {row.gl_reference}. This entry is immutable.
                </AlertDescription>
              </Alert>
            )}

            <Separator />

            <div className="flex flex-wrap gap-2">
              {!isLocked && (
                <Button onClick={handleFinalize} disabled={!canManage || finalizeDay.isPending}>
                  <Lock className="mr-2 h-4 w-4" />
                  Finalize Day &amp; Post ({formatCurrency(effectiveAmount || 0)})
                </Button>
              )}
              {row?.status === "posting_failed" && (
                <Button onClick={handleRetry} disabled={!canManage || retryPosting.isPending}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Retry GL Posting
                </Button>
              )}
              {row && ["finalized", "posting_failed"].includes(row.status) && (
                <Button variant="outline" onClick={() => setReopenOpen(true)} disabled={!canManage}>
                  <Unlock className="mr-2 h-4 w-4" /> Reopen Day
                </Button>
              )}
              {row && ["posted", "adjusted"].includes(row.status) && (
                <Button
                  variant="outline"
                  onClick={() => { setAdjustAmount(Number(row.overhead_amount).toFixed(2)); setAdjustOpen(true); }}
                  disabled={!canManage}
                >
                  <PencilLine className="mr-2 h-4 w-4" /> Adjust / Reverse
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Audit trail */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <History className="h-4 w-4" /> Audit Trail
            </CardTitle>
            <CardDescription>Every finalize, posting, retry and adjustment.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[320px] pr-3">
              {(audit.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity for this business date yet.</p>
              ) : (
                <ol className="space-y-4">
                  {(audit.data ?? []).map(a => (
                    <li key={a.id} className="border-l-2 border-border pl-3">
                      <p className="text-sm font-medium capitalize">{a.action.replace(/_/g, " ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(a.performed_at), "dd MMM yyyy HH:mm")}
                      </p>
                      {a.amount_after != null && (
                        <p className="text-xs">Amount: {formatCurrency(Number(a.amount_after))}
                          {a.amount_before != null && a.amount_before !== a.amount_after
                            ? ` (was ${formatCurrency(Number(a.amount_before))})`
                            : ""}
                        </p>
                      )}
                      {a.gl_reference && <p className="font-mono text-xs text-muted-foreground">{a.gl_reference}</p>}
                      {a.reason && <p className="text-xs italic">Reason: {a.reason}</p>}
                      {a.error_message && <p className="text-xs text-destructive">{a.error_message}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Reporting */}
      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between pb-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" /> Overhead Posting Report
            </CardTitle>
            <CardDescription>Daily overhead, posted vs unposted, GL references and adjustments.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="w-[150px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="w-[150px]" />
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={(period.data ?? []).length === 0}>
              <Download className="mr-2 h-4 w-4" /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Total Overhead</p>
              <p className="text-lg font-light">{formatCurrency(totals.total)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Posted</p>
              <p className="text-lg font-light text-primary">{formatCurrency(totals.posted)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Unposted</p>
              <p className="text-lg font-light">{formatCurrency(totals.unposted)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Adjusted / Failed</p>
              <p className="text-lg font-light">{totals.adjustedCount} / {totals.failedCount}</p>
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business Date</TableHead>
                  <TableHead className="text-right">Overhead</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>GL Reference</TableHead>
                  <TableHead>Posted At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {period.isLoading ? (
                  <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                ) : (period.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      No overhead closures in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  (period.data ?? []).map(r => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setBusinessDate(r.business_date)}>
                      <TableCell>{format(new Date(r.business_date), "dd MMM yyyy")}</TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(r.overhead_amount))}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="font-mono text-xs">{r.gl_reference}</TableCell>
                      <TableCell className="text-xs">
                        {r.posted_at ? format(new Date(r.posted_at), "dd MMM HH:mm") : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Reopen dialog */}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen finalized day</DialogTitle>
            <DialogDescription>
              Reopening unlocks the overhead value for review. Only days that are not yet posted can be reopened.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reopen-reason">Reason (required)</Label>
            <Textarea id="reopen-reason" value={reopenReason} onChange={e => setReopenReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)}>Cancel</Button>
            <Button onClick={handleReopen} disabled={!reopenReason.trim() || reopenDay.isPending}>Reopen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjustment dialog */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Authorised overhead adjustment</DialogTitle>
            <DialogDescription>
              The original posting is reversed and the corrected amount is posted as a new entry. The original transactions stay intact.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="adjust-amount">Corrected overhead amount</Label>
              <Input id="adjust-amount" type="number" step="0.01" min="0" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjust-reason">Reason (required)</Label>
              <Textarea id="adjust-reason" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button onClick={handleAdjust} disabled={!adjustReason.trim() || adjustAmount === "" || adjustDay.isPending}>
              Post adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
