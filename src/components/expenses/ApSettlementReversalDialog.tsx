import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Undo2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { db } from "@/integrations/db/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expenseId: string | null;
  expenseDescription?: string | null;
  amountLabel?: string | null;
  /** False when the signed-in user is not an owner / accountant. */
  authorized: boolean;
  onReversed?: () => void;
}

/**
 * Approval prompt shown before a posted AP settlement is reversed.
 * The database enforces the same role guard, so this dialog is the
 * consent + reason capture layer, never the only line of defence.
 */
export function ApSettlementReversalDialog({
  open,
  onOpenChange,
  expenseId,
  expenseDescription,
  amountLabel,
  authorized,
  onReversed,
}: Props) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setAck(false);
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = authorized && ack && reason.trim().length >= 5 && !submitting;

  const handleConfirm = async () => {
    if (!expenseId) return;
    setSubmitting(true);
    const { data, error } = await db.rpc("request_ap_settlement_reversal" as any, {
      p_expense_id: expenseId,
      p_reason: reason.trim(),
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message || "Reversal could not be posted");
      return;
    }

    const outcome = (data as any)?.outcome;
    if (outcome === "success") {
      toast.success("Reversal posted — the payable has been restored");
    } else {
      toast.info(`Nothing was reversed (${(data as any)?.reason_code ?? "no change"})`);
    }

    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: ["ap-aging"] });
    queryClient.invalidateQueries({ queryKey: ["ap-audit-trail"] });
    queryClient.invalidateQueries({ queryKey: ["expense-settlement-timeline"] });
    onReversed?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-amber-600" /> Approve payment reversal
          </DialogTitle>
          <DialogDescription>
            This posts a new reversal entry (DR Cash on Hand · CR Accounts Payable) and reopens the
            payable. The original settlement stays in the ledger for audit.
          </DialogDescription>
        </DialogHeader>

        {!authorized ? (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Not authorized</p>
              <p className="text-muted-foreground">
                Only owners and accountants can reverse a posted AP settlement. Ask an authorized
                approver to perform this reversal.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="truncate font-medium">{expenseDescription || "Expense"}</p>
              {amountLabel && <p className="text-muted-foreground">Settled amount: {amountLabel}</p>}
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                The expense returns to <strong>unpaid</strong> and the supplier balance reappears in
                AP aging. This action is recorded in the audit trail with your name and timestamp.
              </span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reversal-reason">Reason for reversal (required)</Label>
              <Textarea
                id="reversal-reason"
                rows={3}
                placeholder="e.g. Payment was recorded against the wrong invoice"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {reason.trim().length > 0 && reason.trim().length < 5 && (
                <p className="text-xs text-destructive">Please give at least 5 characters.</p>
              )}
            </div>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" />
              <span className="text-muted-foreground">
                I approve this reversal and confirm the cash payment did not occur or was recorded in
                error.
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {authorized && (
            <Button onClick={handleConfirm} disabled={!canSubmit} className="gap-2">
              <Undo2 className="h-4 w-4" />
              {submitting ? "Posting reversal…" : "Approve & post reversal"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
