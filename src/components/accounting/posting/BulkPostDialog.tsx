import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ReasonBadge, reasonLabel } from "./ReasonBadge";
import type { UnpostedExpense } from "@/hooks/usePostingCenter";
import { postSingleExpense } from "@/hooks/usePostingCenter";
import { useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/contexts/auth/PermissionsContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expenses: UnpostedExpense[];
  branchId: string | null;
  selectedIds?: string[];
}

type RunStatus = "pending" | "running" | "posted" | "blocked" | "failed";
interface RunRow {
  expense_id: string;
  description: string | null;
  amount: number;
  status: RunStatus;
  message?: string;
}

export function BulkPostDialog({
  open,
  onOpenChange,
  expenses,
  branchId,
  selectedIds,
}: Props) {
  const qc = useQueryClient();
  const { isOwner, isManager, isAccountant } = usePermissions();
  const canPost = isOwner || isManager || isAccountant;
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState<RunRow[]>([]);
  const cancelRef = useRef(false);

  const scoped = useMemo(
    () =>
      selectedIds && selectedIds.length > 0
        ? expenses.filter((e) => selectedIds.includes(e.id))
        : expenses,
    [expenses, selectedIds]
  );

  const groups = useMemo(() => {
    const g: Record<string, UnpostedExpense[]> = {};
    for (const e of scoped) {
      const k = e.classification?.reason_code ?? "unknown";
      (g[k] ||= []).push(e);
    }
    return g;
  }, [scoped]);

  const readyCount = groups["ready"]?.length ?? 0;
  const skipCount = scoped.length - readyCount;

  const totals = useMemo(() => {
    const t = { posted: 0, blocked: 0, failed: 0, done: 0 };
    for (const r of progress) {
      if (r.status === "posted") t.posted++;
      else if (r.status === "blocked") t.blocked++;
      else if (r.status === "failed") t.failed++;
      if (r.status !== "pending" && r.status !== "running") t.done++;
    }
    return t;
  }, [progress]);

  const handleRun = async () => {
    if (!canPost) {
      toast.error("You don't have permission to post journal entries.");
      return;
    }
    cancelRef.current = false;
    setRunning(true);
    setDone(false);
    const queue: RunRow[] = scoped.map((e) => ({
      expense_id: e.id,
      description: e.description,
      amount: Number(e.amount),
      status: "pending",
    }));
    setProgress(queue);

    for (let i = 0; i < queue.length; i++) {
      if (cancelRef.current) break;
      // mark running
      setProgress((prev) => {
        const n = [...prev];
        n[i] = { ...n[i], status: "running" };
        return n;
      });
      const res = await postSingleExpense(queue[i].expense_id);
      const status: RunStatus =
        res.outcome === "posted"
          ? "posted"
          : res.outcome === "blocked"
          ? "blocked"
          : "failed";
      setProgress((prev) => {
        const n = [...prev];
        n[i] = {
          ...n[i],
          status,
          message:
            res.outcome === "posted"
              ? `Batch ${(res as any).batch_id?.slice(0, 8) ?? ""}`
              : res.reason_detail || res.error || res.reason_code,
        };
        return n;
      });
    }

    setRunning(false);
    setDone(true);
    qc.invalidateQueries({ queryKey: ["unposted-expenses"] });
    qc.invalidateQueries({ queryKey: ["imbalanced-expenses"] });
    qc.invalidateQueries({ queryKey: ["posting-audit"] });
    qc.invalidateQueries({ queryKey: ["posting-last-errors"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["account-transactions"] });
  };

  const handleClose = () => {
    cancelRef.current = true;
    setRunning(false);
    setDone(false);
    setProgress([]);
    onOpenChange(false);
  };

  const total = progress.length || scoped.length;
  const pct = total === 0 ? 0 : Math.round((totals.done / total) * 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk post to ledger</DialogTitle>
          <DialogDescription>
            {progress.length === 0
              ? "Preview what will happen before posting."
              : `Live progress · ${totals.done}/${total} processed`}
          </DialogDescription>
        </DialogHeader>

        {!canPost && (
          <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs p-2">
            You don't have permission to bulk post. Owners, managers, and accountants only.
          </div>
        )}

        {progress.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <span className="font-medium text-green-700">{readyCount}</span>{" "}
              will post ·{" "}
              <span className="font-medium text-amber-700">{skipCount}</span>{" "}
              will be skipped (blocked by design or pending approval)
            </div>
            <ScrollArea className="max-h-[50vh] pr-2">
              <div className="space-y-3">
                {Object.entries(groups).map(([code, items]) => (
                  <div key={code} className="rounded-md border">
                    <div className="flex items-center justify-between p-2 bg-muted/40">
                      <ReasonBadge code={code as any} />
                      <span className="text-xs text-muted-foreground">
                        {items.length} expense{items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="text-xs divide-y">
                      {items.slice(0, 8).map((e) => (
                        <li
                          key={e.id}
                          className="px-2 py-1.5 flex justify-between gap-2"
                        >
                          <span className="truncate">
                            {e.expense_date} ·{" "}
                            {e.description ?? "(no description)"}
                          </span>
                          <span className="tabular-nums">
                            {Number(e.amount).toFixed(2)}
                          </span>
                        </li>
                      ))}
                      {items.length > 8 && (
                        <li className="px-2 py-1.5 text-muted-foreground">
                          + {items.length - 8} more…
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>
                  {totals.done}/{total} · {pct}%
                </span>
              </div>
              <Progress value={pct} />
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-xs text-muted-foreground">Attempted</div>
                <div className="text-lg font-semibold">{totals.done}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Posted</div>
                <div className="text-lg font-semibold text-green-700">{totals.posted}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Skipped</div>
                <div className="text-lg font-semibold text-amber-700">{totals.blocked}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Failed</div>
                <div className="text-lg font-semibold text-destructive">{totals.failed}</div>
              </div>
            </div>
            <ScrollArea className="max-h-[50vh] pr-2">
              <ul className="text-xs divide-y border rounded-md">
                {progress.map((d, i) => (
                  <li key={d.expense_id} className="px-2 py-1.5 flex items-center gap-2">
                    <span className="w-5">
                      {d.status === "posted" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : d.status === "failed" ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : d.status === "blocked" ? (
                        <MinusCircle className="h-4 w-4 text-amber-600" />
                      ) : d.status === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <span className="text-muted-foreground text-xs">{i + 1}</span>
                      )}
                    </span>
                    <span className="flex-1 truncate">
                      {d.description ?? "(no description)"}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {d.amount.toFixed(2)}
                    </span>
                    {d.message && (
                      <span
                        className={`text-[11px] truncate max-w-[260px] ${
                          d.status === "failed"
                            ? "text-destructive"
                            : d.status === "blocked"
                            ? "text-amber-700"
                            : "text-muted-foreground"
                        }`}
                        title={d.message}
                      >
                        {d.status === "blocked"
                          ? reasonLabel((d.message ?? "") as any)
                          : d.message}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          {progress.length === 0 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRun}
                disabled={!canPost || readyCount === 0 || running}
              >
                {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Post {readyCount} eligible
              </Button>
            </>
          ) : running ? (
            <Button
              variant="outline"
              onClick={() => {
                cancelRef.current = true;
              }}
            >
              Stop after current
            </Button>
          ) : (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}