import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Download,
  Info,
  Loader2,
  Wand2,
  XCircle,
} from "lucide-react";
import {
  useImbalancedExpenses,
  autoReconcileSingleExpense,
  type ImbalancedExpense,
} from "@/hooks/usePostingCenter";
import { useEnqueuePostingJob } from "@/hooks/usePostingJobs";
import { downloadCsv, toCsv } from "./postingCsv";
import { ExplainReconcileDrawer } from "./ExplainReconcileDrawer";
import { usePermissions } from "@/contexts/auth/PermissionsContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  branchId: string | null;
  /** Optional pre-filtered slice from the parent. Defaults to the hook result. */
  rows?: ImbalancedExpense[];
}

type RunStatus = "pending" | "running" | "fixed" | "already_balanced" | "needs_manual_review" | "failed";

export function ImbalancedPanel({ branchId, rows: rowsProp }: Props) {
  const { data: hookRows = [], isLoading } = useImbalancedExpenses(branchId);
  const rows = rowsProp ?? hookRows;
  const qc = useQueryClient();
  const { isOwner, isManager, isAccountant } = usePermissions();
  const canReconcile = isOwner || isManager || isAccountant;
  const enqueueJob = useEnqueuePostingJob();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, { status: RunStatus; message?: string }>>({});
  const [explainId, setExplainId] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const totals = useMemo(() => {
    const t = { done: 0, fixed: 0, manual: 0, failed: 0 };
    Object.values(progress).forEach((p) => {
      if (p.status === "fixed") {
        t.done++;
        t.fixed++;
      } else if (p.status === "needs_manual_review" || p.status === "already_balanced") {
        t.done++;
        if (p.status === "needs_manual_review") t.manual++;
      } else if (p.status === "failed") {
        t.done++;
        t.failed++;
      }
    });
    return t;
  }, [progress]);

  const handleExportCsv = () => {
    const headers = ["expense_date", "description", "amount", "branch", "dr_total", "cr_total", "diff", "expense_id"];
    const data = rows.map((r) => ({
      expense_date: r.expense_date,
      description: r.description ?? "",
      amount: Number(r.amount).toFixed(2),
      branch: r.branch?.name ?? "",
      dr_total: r.dr_total.toFixed(2),
      cr_total: r.cr_total.toFixed(2),
      diff: r.diff.toFixed(2),
      expense_id: r.id,
    }));
    downloadCsv(`imbalanced-ledger-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data, headers));
  };

  const handleAutoReconcileAll = async () => {
    if (!canReconcile) {
      toast.error("You don't have permission to approve auto-reconcile changes.");
      return;
    }
    cancelRef.current = false;
    setRunning(true);
    const init: Record<string, { status: RunStatus }> = {};
    rows.forEach((r) => (init[r.id] = { status: "pending" }));
    setProgress(init);

    for (const r of rows) {
      if (cancelRef.current) break;
      setProgress((prev) => ({ ...prev, [r.id]: { status: "running" } }));
      const res = await autoReconcileSingleExpense(r.id);
      const status: RunStatus =
        res.outcome === "fixed"
          ? "fixed"
          : res.outcome === "already_balanced"
          ? "already_balanced"
          : res.outcome === "needs_manual_review"
          ? "needs_manual_review"
          : "failed";
      setProgress((prev) => ({
        ...prev,
        [r.id]: {
          status,
          message:
            res.outcome === "fixed"
              ? `Fixed Δ ${Number((res as any).diff ?? 0).toFixed(2)}`
              : (res as any).error || res.reason_code,
        },
      }));
    }

    setRunning(false);
    qc.invalidateQueries({ queryKey: ["imbalanced-expenses"] });
    qc.invalidateQueries({ queryKey: ["posting-audit"] });
    qc.invalidateQueries({ queryKey: ["account-transactions"] });
  };

  const handleReconcileOne = async (id: string) => {
    if (!canReconcile) {
      toast.error("You don't have permission to approve auto-reconcile changes.");
      return;
    }
    setProgress((prev) => ({ ...prev, [id]: { status: "running" } }));
    const res = await autoReconcileSingleExpense(id);
    const status: RunStatus =
      res.outcome === "fixed"
        ? "fixed"
        : res.outcome === "already_balanced"
        ? "already_balanced"
        : res.outcome === "needs_manual_review"
        ? "needs_manual_review"
        : "failed";
    setProgress((prev) => ({
      ...prev,
      [id]: {
        status,
        message:
          res.outcome === "fixed"
            ? `Fixed Δ ${Number((res as any).diff ?? 0).toFixed(2)}`
            : (res as any).error || res.reason_code,
      },
    }));
    qc.invalidateQueries({ queryKey: ["imbalanced-expenses"] });
    qc.invalidateQueries({ queryKey: ["posting-audit"] });
  };

  const total = rows.length;
  const pct = total === 0 ? 0 : Math.round((totals.done / total) * 100);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Imbalanced postings
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {rows.length} posted expense{rows.length === 1 ? "" : "s"} where DR ≠ CR
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={rows.length === 0}
          >
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canReconcile || rows.length === 0 || enqueueJob.isPending}
            onClick={() =>
              enqueueJob.mutate({
                branchId,
                jobType: "auto_reconcile",
                expenseIds: rows.map((r) => r.id),
              })
            }
            title={!canReconcile ? "Owners, managers, and accountants only" : "Run in background"}
          >
            <CloudUpload className="h-4 w-4 mr-1" /> Run in background
          </Button>
          <Button
            size="sm"
            disabled={!canReconcile || rows.length === 0 || running}
            onClick={handleAutoReconcileAll}
            title={!canReconcile ? "Owners, managers, and accountants only" : undefined}
          >
            {running ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-1" />
            )}
            Auto-reconcile all
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!canReconcile && (
          <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs p-2 mb-3">
            Read-only view — approving reconcile changes requires owner, manager, or accountant role.
          </div>
        )}
        {running && (
          <div className="space-y-1 mb-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Reconciling…</span>
              <span>
                {totals.done}/{total} · {totals.fixed} fixed · {totals.manual} need review · {totals.failed} failed
              </span>
            </div>
            <Progress value={pct} />
          </div>
        )}
        {isLoading ? (
          <div className="text-sm text-muted-foreground p-4">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            All posted expenses are balanced.
          </div>
        ) : (
          <ScrollArea className="max-h-[55vh] pr-2">
            <ul className="divide-y border rounded-md">
              {rows.map((r) => {
                const expectedFix = Math.abs(r.diff - r.amount) <= 0.01;
                const p = progress[r.id];
                return (
                  <li key={r.id} className="p-3 text-sm space-y-1">
                    <div className="flex justify-between gap-2">
                      <div className="font-medium truncate">
                        {r.description ?? "(no description)"}
                      </div>
                      <div className="tabular-nums">{Number(r.amount).toFixed(2)}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.expense_date}
                      {r.branch?.name && ` · ${r.branch.name}`}
                    </div>
                    <div className="text-xs grid grid-cols-3 gap-2 mt-1">
                      <div>
                        DR: <span className="tabular-nums">{r.dr_total.toFixed(2)}</span>
                      </div>
                      <div>
                        CR:{" "}
                        <span
                          className={
                            expectedFix ? "tabular-nums" : "tabular-nums text-rose-600 font-medium"
                          }
                        >
                          {r.cr_total.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-right">
                        Δ{" "}
                        <span className="tabular-nums text-destructive">
                          {r.diff.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    {!expectedFix && (
                      <p className="text-xs text-rose-600 mt-1">
                        Manual review: imbalance doesn't match a single missing-leg pattern.
                      </p>
                    )}
                    {p && (
                      <div className="flex items-center gap-1 text-xs mt-1">
                        {p.status === "fixed" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        ) : p.status === "failed" ? (
                          <XCircle className="h-3.5 w-3.5 text-destructive" />
                        ) : p.status === "needs_manual_review" ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        ) : p.status === "running" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        <span
                          className={
                            p.status === "fixed"
                              ? "text-green-700"
                              : p.status === "failed"
                              ? "text-destructive"
                              : "text-amber-700"
                          }
                        >
                          {p.message ?? p.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => setExplainId(r.id)}
                      >
                        <Info className="h-3.5 w-3.5 mr-1" /> Explain reconcile
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={!canReconcile || p?.status === "running"}
                        onClick={() => handleReconcileOne(r.id)}
                      >
                        <Wand2 className="h-3.5 w-3.5 mr-1" /> Auto-fix
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
      <ExplainReconcileDrawer
        expenseId={explainId}
        open={explainId !== null}
        onOpenChange={(o) => !o && setExplainId(null)}
      />
    </Card>
  );
}