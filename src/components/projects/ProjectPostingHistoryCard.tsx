import { useState } from "react";
import { History, Undo2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrency } from "@/hooks/useCurrency";
import type { useProjects } from "@/hooks/useProjects";

type ProjectsApi = ReturnType<typeof useProjects>;

function scopeText(run: ProjectsApi["postingRuns"][number]) {
  const parts: string[] = [];
  if (run.category) parts.push(run.category);
  if (run.date_from || run.date_to) parts.push(`${run.date_from ?? "start"} → ${run.date_to ?? "today"}`);
  if (run.shift) parts.push(run.shift === "morning" ? "morning shift" : "night shift");
  return parts.length ? parts.join(" · ") : "All pending";
}

export function ProjectPostingHistoryCard({ api }: { api: ProjectsApi }) {
  const { format: money } = useCurrency();
  const runs = api.postingRuns;
  const [undoTarget, setUndoTarget] = useState<ProjectsApi["postingRuns"][number] | null>(null);
  const [working, setWorking] = useState(false);
  const latestActiveId = runs.find((r) => !r.undone_at)?.id ?? null;

  const runUndo = async () => {
    if (!undoTarget) return;
    setWorking(true);
    try {
      const res = await api.undoPostingRun.mutateAsync(undoTarget);
      if (res.reverted.length > 0) {
        toast.success(
          `Reverted ${res.reverted.length} transaction(s) back to Pending`,
          res.failures.length
            ? { description: `${res.failures.length} could not be reverted` }
            : undefined,
        );
      }
      if (res.failures.length > 0 && res.reverted.length === 0) {
        toast.error(res.failures[0].message);
      }
      setUndoTarget(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not undo this posting run");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <History className="h-4 w-4 text-primary" /> Posting history
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Every confirm-posting run: who ran it, when, how many transactions and the total posted.
        </p>
      </CardHeader>
      <CardContent>
        {api.postingRunsLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No confirm-posting runs recorded yet.
          </div>
        ) : (
          <ScrollArea className="max-h-[45vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">When</TableHead>
                  <TableHead className="text-xs">By</TableHead>
                  <TableHead className="text-xs">Scope</TableHead>
                  <TableHead className="text-xs text-right">Posted</TableHead>
                  <TableHead className="text-xs text-right">Failed</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                  <TableHead className="text-xs text-right">Undo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {format(new Date(run.performed_at), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {run.performed_by_name ?? "Unknown user"}
                    </TableCell>
                    <TableCell className="text-xs">{scopeText(run)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {run.txn_count}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {run.failed_count > 0 ? (
                        <Badge variant="destructive" className="text-[10px]">
                          {run.failed_count}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-medium">
                      {money(Number(run.total_amount ?? 0))}
                    </TableCell>
                    <TableCell className="text-right">
                      {run.undone_at ? (
                        <Badge variant="outline" className="text-[10px]">
                          Undone {format(new Date(run.undone_at), "MMM d")}
                        </Badge>
                      ) : run.id === latestActiveId ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setUndoTarget(run)}
                        >
                          <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
    <AlertDialog open={!!undoTarget} onOpenChange={(o) => !o && !working && setUndoTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Undo this confirm posting?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {undoTarget?.txn_count} transaction(s) totalling{" "}
                <span className="font-medium">{money(Number(undoTarget?.total_amount ?? 0))}</span>{" "}
                will move back to Pending.
              </p>
              <p className="text-xs">
                The ledger entries are reversed (not deleted) so the audit trail stays intact.
                Postings that created a fixed asset cannot be undone here.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={working}
            onClick={(e) => {
              e.preventDefault();
              void runUndo();
            }}
          >
            {working ? "Reverting…" : "Undo posting"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
