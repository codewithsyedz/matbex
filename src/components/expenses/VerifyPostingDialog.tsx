import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link as RouterLink } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  EXPENSE_LEDGER_ISSUE_LABELS,
  useExpenseLedgerReconciliation,
} from "@/hooks/useExpenseLedgerReconciliation";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
}

function VerifyPostingBody({ branchId, from, to }: Omit<Props, "open" | "onOpenChange">) {
  const { rows, totals, isLoading, isFetching, error, refetch } =
    useExpenseLedgerReconciliation({ branchId, from, to });

  const flagged = useMemo(() => rows.filter((r) => r.issue !== "ok"), [rows]);
  const clean = totals.scanned > 0 && totals.flagged === 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Running reconciliation check…
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-destructive">{error.message}</div>;
  }

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border p-3 flex items-start gap-3 ${
          clean ? "border-green-500/40 bg-green-50/60" : "border-destructive/40 bg-destructive/5"
        }`}
      >
        {clean ? (
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
        )}
        <div className="text-sm">
          <p className="font-medium">
            {clean
              ? "Ledger matches the expense sub-ledger"
              : `${totals.flagged} of ${totals.scanned} expenses don't match the ledger`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totals.scanned} expenses checked in the current filter range.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {[
          { label: "Never posted", value: totals.notPosted },
          { label: "Posted, no legs", value: totals.postedNoLegs },
          { label: "Unbalanced", value: totals.unbalanced },
          { label: "Amount mismatch", value: totals.amountMismatch },
        ].map((c) => (
          <div key={c.label} className="rounded-md border p-2">
            <div className="text-muted-foreground">{c.label}</div>
            <div className="text-lg font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      {flagged.length > 0 && (
        <ScrollArea className="max-h-[40vh] rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-1.5">Date</th>
                <th className="text-left px-3 py-1.5">Description</th>
                <th className="text-left px-3 py-1.5">Issue</th>
                <th className="text-right px-3 py-1.5">Bill</th>
                <th className="text-right px-3 py-1.5">Ledger DR</th>
              </tr>
            </thead>
            <tbody>
              {flagged.slice(0, 100).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-1.5 tabular-nums">{r.expenseDate}</td>
                  <td className="px-3 py-1.5 max-w-[220px] truncate">
                    {r.description ?? "—"}
                    {r.supplierName && (
                      <span className="text-muted-foreground"> · {r.supplierName}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {EXPENSE_LEDGER_ISSUE_LABELS[r.issue]}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.billed.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.primaryDrTotal.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Re-run check
        </Button>
        <Button asChild size="sm" className="gap-1.5">
          <RouterLink to="/reports/expense-ledger-reconciliation">
            Open full reconciliation
            <ExternalLink className="h-4 w-4" />
          </RouterLink>
        </Button>
      </DialogFooter>
    </div>
  );
}

export function VerifyPostingDialog({ open, onOpenChange, branchId, from, to }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verify posting</DialogTitle>
          <DialogDescription>
            Compares every expense in the current filters against its journal lines in the
            transaction ledger.
          </DialogDescription>
        </DialogHeader>
        {open && <VerifyPostingBody branchId={branchId} from={from} to={to} />}
      </DialogContent>
    </Dialog>
  );
}
