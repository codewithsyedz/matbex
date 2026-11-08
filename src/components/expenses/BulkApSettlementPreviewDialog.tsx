import { useEffect, useMemo } from "react";
import { Loader2, AlertTriangle, Banknote, Landmark, Coins } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useApSettlementPreviews } from "@/hooks/useApSettlementPreview";
import { ApSettlementPreviewBody } from "./ApSettlementPostingPreview";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { selectablePaymentAccounts } from "@/lib/paymentAccountRules";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expenses: Array<{ id: string; description?: string | null; amount: number }>;
  onConfirm: () => void;
  isPending?: boolean;
  /** Chosen paying account (chart-of-accounts id). */
  paymentAccountId: string | null;
  onPaymentAccountChange: (accountId: string | null) => void;
}

function iconForAccount(name: string) {
  if (/petty/i.test(name)) return Coins;
  if (/bank/i.test(name)) return Landmark;
  return Banknote;
}

/**
 * Confirmation step for bulk "mark as paid": shows the DR/CR lines that will be
 * posted for every selected bill before anything is written to the ledger.
 */
export function BulkApSettlementPreviewDialog({
  open,
  onOpenChange,
  expenses,
  onConfirm,
  isPending,
  paymentAccountId,
  onPaymentAccountChange,
}: Props) {
  const { format } = useCurrency();
  const { accounts } = useChartOfAccounts();
  const results = useApSettlementPreviews(
    expenses.map((e) => e.id),
    open
  );

  const payAccounts = useMemo(
    () => selectablePaymentAccounts(accounts as any[]),
    [accounts]
  );

  // Preselect Cash in Hand when nothing has been chosen yet.
  useEffect(() => {
    if (!open || paymentAccountId || payAccounts.length === 0) return;
    const preferred =
      payAccounts.find((a: any) => a.account_code === "1000") ?? payAccounts[0];
    onPaymentAccountChange((preferred as any)?.id ?? null);
  }, [open, paymentAccountId, payAccounts, onPaymentAccountChange]);

  const loading = results.some((r) => r.isLoading);
  const previews = results.map((r) => r.data);
  const totalSettlement = previews.reduce(
    (s, p) => s + (p?.amount ?? 0),
    0
  );
  const blocking = previews.some((p) =>
    (p?.warnings || []).some((w) => w.level === "error")
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Confirm settlement posting</DialogTitle>
          <DialogDescription>
            Review the accounts that will be hit for each bill before saving.
          </DialogDescription>
        </DialogHeader>

        {blocking && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              One or more bills would post to an invalid account. Fix the paying
              account before settling.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Which money is paying?</p>
          {payAccounts.length === 0 ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                No cash or bank account is set up yet. Add one in the chart of
                accounts before settling bills.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {payAccounts.map((acc: any) => {
                const Icon = iconForAccount(String(acc.account_name ?? ""));
                const selected = paymentAccountId === acc.id;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => onPaymentAccountChange(acc.id)}
                    className={`rounded-lg border p-3 text-left transition-colors min-h-[56px] ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <Icon className="h-4 w-4 mb-1.5 text-muted-foreground" />
                    <p className="text-sm font-medium leading-tight">
                      {acc.account_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {acc.account_code}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <ScrollArea className="max-h-[50vh] pr-3">
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Building preview…
              </div>
            ) : (
              expenses.map((exp, i) => (
                <div key={exp.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {exp.description || "Expense"}
                    </span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {format(Number(exp.amount) || 0)}
                    </span>
                  </div>
                  {previews[i] ? (
                    <ApSettlementPreviewBody preview={previews[i]!} compact />
                  ) : null}
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            Total to settle: {format(totalSettlement)}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={loading || isPending || blocking || !paymentAccountId}
            >
              {isPending ? "Posting…" : "Confirm & mark paid"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BulkApSettlementPreviewDialog;
