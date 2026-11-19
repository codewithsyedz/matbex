import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, ShieldCheck, Lock, Mail, ChevronDown, ChevronUp } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { db } from "@/integrations/db/client";
import { usePermissions, useProfile, useTenant } from "@/contexts/auth/AuthFacade";
import {
  AMEND_PERMISSION_MESSAGE,
  AMEND_POSTED_EXPENSE_ROLES,
  canAmendPostedExpense,
  type MaterialChange,
} from "@/lib/postedExpenseGuard";
import {
  describeAmendError,
  AMEND_ROLE_ERROR,
  AMEND_POSTED_EXPENSE_ROLE_LABELS,
  type AmendErrorInfo,
} from "@/lib/amendmentErrors";

export type AmendPayload = {
  expenseId: string;
  amount: number;
  expenseDate: string;
  description: string | null;
  categoryId: string | null;
  accountId: string | null;
  supplierId: string | null;
};

interface AmendPostedExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: MaterialChange[];
  payload: AmendPayload | null;
  onAmended?: () => void;
}

/**
 * Posted expenses cannot be edited in place. This dialog collects the mandatory
 * reason and calls `amend_posted_expense`, which reverses the original journal
 * entry with an adjusting entry and re-posts the corrected figures.
 */
export function AmendPostedExpenseDialog({
  open,
  onOpenChange,
  changes,
  payload,
  onAmended,
}: AmendPostedExpenseDialogProps) {
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [failure, setFailure] = useState<AmendErrorInfo | null>(null);
  const [showRequestAccess, setShowRequestAccess] = useState(false);
  const queryClient = useQueryClient();
  const { hasRole } = usePermissions();
  const { profile } = useProfile();
  const { tenant } = useTenant();
  const canAmend = canAmendPostedExpense((role) => hasRole(role as any));

  const currentUserName = profile?.full_name || "a team member";
  const tenantName = tenant?.name || "your restaurant";
  const requiredRoleLabels = (AMEND_ROLE_ERROR.requiredRoles ?? AMEND_POSTED_EXPENSE_ROLES)
    .map((r) => AMEND_POSTED_EXPENSE_ROLE_LABELS[r] ?? r)
    .join(", ");

  const amendMutation = useMutation({
    mutationFn: async () => {
      if (!payload) throw new Error("Nothing to amend");
      if (!canAmend) throw new Error(AMEND_PERMISSION_MESSAGE);
      const { data, error } = await (db as any).rpc(
        "amend_posted_expense",
        {
          p_expense_id: payload.expenseId,
          p_reason: reason.trim(),
          p_amount: payload.amount,
          p_vat_amount: null,
          p_expense_date: payload.expenseDate,
          p_description: payload.description,
          p_category_id: payload.categoryId,
          p_account_id: payload.accountId,
          p_supplier_id: payload.supplierId,
        }
      );
      if (error) throw error;
      return data;
    },
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: () => {
      [
        "expenses",
        "expenses-totals",
        "expenses-pending-total",
        "expenses-pending-count",
        "account-transactions",
        "expense-posting-status",
        "expense-ledger-reconciliation",
        "supplier-ledger",
        "expense-amendment-audit",
        "profit-loss-by-branch",
        "profit-loss",
        "balance-sheet",
        "cash-flow",
        "vat-recoverable-reconciliation",
        "zatca-reconciliation",
      ].forEach((key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      );
      queryClient.invalidateQueries();
      toast.success("Expense amended", {
        description:
          "An adjusting journal entry was posted and the ledger was updated.",
      });
      setReason("");
      setAcknowledged(false);
      onOpenChange(false);
      onAmended?.();
    },
    onError: (err: any) => {
      const info = describeAmendError(err);
      setFailure(info);
      toast.error(info.title, { description: info.description });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Amend posted expense
          </DialogTitle>
          <DialogDescription>
            This expense is already in the general ledger. Saving will post a
            reversing adjusting journal entry and re-post the corrected
            amounts — nothing is edited silently.
          </DialogDescription>
        </DialogHeader>

        {!canAmend && (
          <Alert variant="destructive">
            <Lock className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <span className="font-medium">Elevated access required. </span>
              {AMEND_PERMISSION_MESSAGE}
              <div className="mt-1 text-[11px] opacity-90">
                Allowed roles: {requiredRoleLabels}
              </div>
              <RequestAccessCta
                open={showRequestAccess}
                onToggle={() => setShowRequestAccess((v) => !v)}
                tenantName={tenantName}
                userName={currentUserName}
                requiredRoleLabels={requiredRoleLabels}
              />
            </AlertDescription>
          </Alert>
        )}

        {failure && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs space-y-1">
              <div className="font-medium">{failure.title}</div>
              <div>{failure.description}</div>
              {failure.requiredRoles && (
                <div className="text-[11px] opacity-90">
                  Allowed roles:{" "}
                  {failure.requiredRoles
                    .map((r) => AMEND_POSTED_EXPENSE_ROLE_LABELS[r] ?? r)
                    .join(", ")}
                </div>
              )}
              {failure.kind === "permission" && (
                <RequestAccessCta
                  open={showRequestAccess}
                  onToggle={() => setShowRequestAccess((v) => !v)}
                  tenantName={tenantName}
                  userName={currentUserName}
                  requiredRoleLabels={requiredRoleLabels}
                />
              )}
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            The original entry stays in the ledger. The adjustment is
            referenced as <span className="font-mono">EXPADJ-…</span> and is
            recorded in the expense posting audit trail.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Changes requiring an adjustment
          </Label>
          <div className="rounded-md border divide-y">
            {changes.map((c) => (
              <div
                key={c.field}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">{c.label}</span>
                <span className="flex items-center gap-2 font-medium">
                  <span className="line-through text-muted-foreground">
                    {c.from}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span>{c.to}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="amend-reason">Reason for amendment</Label>
          <Textarea
            id="amend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Supplier issued a revised invoice with a corrected total"
            rows={3}
            disabled={!canAmend}
          />
        </div>

        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={acknowledged}
            disabled={!canAmend}
            onCheckedChange={(v) => setAcknowledged(v === true)}
            className="mt-0.5"
          />
          <span>
            I confirm I am authorised to amend posted accounting records and
            that this adjustment will be recorded against my user in the audit
            trail.
          </span>
        </label>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={amendMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => amendMutation.mutate()}
            disabled={
              amendMutation.isPending ||
              !canAmend ||
              !acknowledged ||
              reason.trim().length < 3
            }
          >
            {!canAmend
              ? "Elevated access required"
              : amendMutation.isPending
              ? "Posting adjustment..."
              : "Post adjustment & save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RequestAccessCtaProps {
  open: boolean;
  onToggle: () => void;
  tenantName: string;
  userName: string;
  requiredRoleLabels: string;
}

/**
 * Collapsible "Request access" call-to-action shown inside permission error
 * alerts. Explains which role is required and who to contact, and offers a
 * copyable request message the user can hand to an owner/admin.
 */
function RequestAccessCta({
  open,
  onToggle,
  tenantName,
  userName,
  requiredRoleLabels,
}: RequestAccessCtaProps) {
  const requestMessage =
    `Hi, I'm ${userName} at ${tenantName}. ` +
    `I need to amend a posted expense but my account lacks the required role. ` +
    `Please grant me one of: ${requiredRoleLabels} so I can post the adjusting entry. ` +
    `Reference: Matbex → Expenses → Amend posted expense.`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(requestMessage);
      toast.success("Request copied", {
        description: "Paste it into a message to your owner or admin.",
      });
    } catch {
      toast.error("Couldn't copy", {
        description: "Select the text above and copy it manually.",
      });
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-[11px] font-medium underline-offset-2 hover:underline text-foreground/80"
      >
        <Mail className="h-3 w-3" />
        Request access
        {open ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {open && (
        <div className="mt-2 rounded-md border bg-background/60 p-2.5 space-y-2 text-[11px]">
          <p>
            <span className="font-medium">Who to contact:</span> an{" "}
            <span className="font-medium">Owner</span> or{" "}
            <span className="font-medium">Super Admin</span> of{" "}
            <span className="font-medium">{tenantName}</span> can assign roles
            from the Team page.
          </p>
          <p>
            <span className="font-medium">Role required:</span>{" "}
            {requiredRoleLabels}. One of these lets you post the reversing
            adjusting entry that amends a posted expense.
          </p>
          <div className="rounded-md border bg-muted/40 p-2 font-mono leading-relaxed">
            {requestMessage}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 text-[11px]"
            onClick={handleCopy}
          >
            Copy request message
          </Button>
        </div>
      )}
    </div>
  );
}
