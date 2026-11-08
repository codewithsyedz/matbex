import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Zap, Download, RotateCw, CloudUpload } from "lucide-react";
import { ReasonBadge } from "./ReasonBadge";
import { BulkPostDialog } from "./BulkPostDialog";
import {
  useUnpostedExpenses,
  useLatestPostingErrors,
  postSingleExpense,
  type UnpostedExpense,
} from "@/hooks/usePostingCenter";
import { useEnqueuePostingJob } from "@/hooks/usePostingJobs";
import { downloadCsv, toCsv } from "./postingCsv";
import { usePermissions } from "@/contexts/auth/PermissionsContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  branchId: string | null;
  /** Optional pre-filtered slice from the parent. Defaults to the hook result. */
  rows?: UnpostedExpense[];
}

export function UnpostedLedgerPanel({ branchId, rows: rowsProp }: Props) {
  const { data: hookRows = [], isLoading } = useUnpostedExpenses(branchId);
  const rows = rowsProp ?? hookRows;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { isOwner, isManager, isAccountant } = usePermissions();
  const canPost = isOwner || isManager || isAccountant;
  const enqueueJob = useEnqueuePostingJob();

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const { data: errorsMap = {} } = useLatestPostingErrors(ids);

  const grouped = useMemo(() => {
    const g: Record<string, typeof rows> = {};
    for (const r of rows) {
      const k = r.classification?.reason_code ?? "unknown";
      (g[k] ||= []).push(r);
    }
    // Sort: ready first, then alphabetical
    return Object.entries(g).sort(([a], [b]) =>
      a === "ready" ? -1 : b === "ready" ? 1 : a.localeCompare(b)
    );
  }, [rows]);

  const readyIds = useMemo(
    () => rows.filter((r) => r.classification?.reason_code === "ready").map((r) => r.id),
    [rows]
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleExportCsv = () => {
    const headers = [
      "expense_date",
      "description",
      "amount",
      "branch",
      "account_code",
      "account_name",
      "approval_status",
      "status",
      "reason_code",
      "reason_detail",
      "last_error",
      "expense_id",
    ];
    const data = rows.map((r) => ({
      expense_date: r.expense_date,
      description: r.description ?? "",
      amount: Number(r.amount).toFixed(2),
      branch: r.branch?.name ?? "",
      account_code: r.account?.account_code ?? "",
      account_name: r.account?.account_name ?? "",
      approval_status: r.approval_status ?? "",
      status: r.status ?? "",
      reason_code: r.classification?.reason_code ?? "",
      reason_detail: r.classification?.reason_detail ?? "",
      last_error: errorsMap[r.id]?.reason_detail ?? "",
      expense_id: r.id,
    }));
    downloadCsv(`unposted-ledger-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data, headers));
  };

  const handleRetry = async (id: string) => {
    if (!canPost) {
      toast.error("You don't have permission to post journal entries.");
      return;
    }
    setRetryingId(id);
    const res = await postSingleExpense(id);
    setRetryingId(null);
    if (res.outcome === "posted") {
      toast.success("Posted to ledger");
    } else if (res.outcome === "blocked") {
      toast.warning(`Blocked: ${res.reason_detail ?? res.reason_code}`);
    } else {
      toast.error(`Failed: ${res.error ?? res.reason_code}`);
    }
    qc.invalidateQueries({ queryKey: ["unposted-expenses"] });
    qc.invalidateQueries({ queryKey: ["posting-audit"] });
    qc.invalidateQueries({ queryKey: ["posting-last-errors"] });
    qc.invalidateQueries({ queryKey: ["imbalanced-expenses"] });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-medium">Unposted ledger entries</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {rows.length} total · {readyIds.length} ready to post
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
            disabled={!canPost || readyIds.length === 0 || enqueueJob.isPending}
            onClick={() =>
              enqueueJob.mutate({
                branchId,
                jobType: "bulk_post",
                expenseIds: readyIds,
              })
            }
            title={
              !canPost
                ? "Owners, managers, and accountants only"
                : "Run in background — you can leave this page"
            }
          >
            <CloudUpload className="h-4 w-4 mr-1" /> Run in background
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canPost || selected.size === 0}
            onClick={() => setDialogOpen(true)}
            title={!canPost ? "Owners, managers, and accountants only" : undefined}
          >
            Post selected ({selected.size})
          </Button>
          <Button
            size="sm"
            disabled={!canPost || readyIds.length === 0}
            onClick={() => {
              setSelected(new Set(readyIds));
              setDialogOpen(true);
            }}
            title={!canPost ? "Owners, managers, and accountants only" : undefined}
          >
            <Zap className="h-4 w-4 mr-1" />
            Bulk post eligible
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!canPost && (
          <div className="rounded-md border border-warning/30 bg-warning/10 text-foreground text-xs p-2 mb-3">
            Read-only view — bulk posting requires owner, manager, or accountant role.
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analyzing unposted entries…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            🎉 All approved expenses are posted.
          </div>
        ) : (
          <ScrollArea className="max-h-[55vh] pr-2">
            <div className="space-y-4">
              {grouped.map(([code, items]) => (
                <div key={code} className="rounded-md border">
                  <div className="flex items-center justify-between p-2 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <ReasonBadge code={code as any} />
                      <span className="text-xs text-muted-foreground">
                        {items.length} expense{items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {items[0]?.classification?.reason_detail && (
                      <span className="text-xs text-muted-foreground truncate max-w-md">
                        {items[0].classification.reason_detail}
                      </span>
                    )}
                  </div>
                  <ul className="divide-y">
                    {items.map((r) => (
                      <li
                        key={r.id}
                        className="px-3 py-2 flex items-center gap-3 text-sm"
                      >
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={() => toggle(r.id)}
                          disabled={r.classification?.reason_code !== "ready"}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {r.description ?? "(no description)"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.expense_date}
                            {r.branch?.name && ` · ${r.branch.name}`}
                            {r.account?.account_code &&
                              ` · ${r.account.account_code} ${r.account.account_name}`}
                          </div>
                          {errorsMap[r.id] && (
                            <div className="text-[11px] text-destructive mt-0.5 truncate">
                              Last error: {errorsMap[r.id].reason_detail || errorsMap[r.id].reason_code}
                            </div>
                          )}
                        </div>
                        <div className="tabular-nums text-sm">
                          {Number(r.amount).toFixed(2)}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          disabled={
                            !canPost ||
                            retryingId === r.id ||
                            r.classification?.reason_code !== "ready"
                          }
                          onClick={() => handleRetry(r.id)}
                          title={
                            r.classification?.reason_code !== "ready"
                              ? "Resolve blocking reason first"
                              : "Retry posting"
                          }
                        >
                          {retryingId === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
      <BulkPostDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expenses={rows}
        branchId={branchId}
        selectedIds={Array.from(selected)}
      />
    </Card>
  );
}