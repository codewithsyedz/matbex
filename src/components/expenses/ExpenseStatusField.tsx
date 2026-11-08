import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPaymentMethodStatusWarning } from "@/lib/expensePaymentValidation";

export type ExpenseStatus = "paid" | "unpaid";

interface ExpenseStatusFieldProps {
  value: ExpenseStatus;
  onChange: (value: ExpenseStatus) => void;
  paymentMethod?: string;
  locked?: boolean;
  lockedReason?: string;
  showLedgerHint?: boolean;
  /** Called when the user accepts the suggested fix from the mismatch warning. */
  onFixToUnpaid?: () => void;
}

const STATUS_META: Record<
  ExpenseStatus,
  { label: string; short: string; icon: typeof CheckCircle2; tone: string }
> = {
  paid: {
    label: "Paid",
    short: "Cash / bank purchase",
    icon: CheckCircle2,
    tone: "text-green-600",
  },
  unpaid: {
    label: "Unpaid",
    short: "On credit / supplier bill",
    icon: Clock,
    tone: "text-amber-600",
  },
};

export function ExpenseStatusField({
  value,
  onChange,
  paymentMethod = "cash",
  locked = false,
  lockedReason,
  showLedgerHint = true,
  onFixToUnpaid,
}: ExpenseStatusFieldProps) {
  const mismatch = getPaymentMethodStatusWarning(value, paymentMethod);
  const paidLedgerLines = [
    "DR Expense or Inventory account",
    `CR ${
      paymentMethod === "cash"
        ? "1000 Cash on Hand"
        : "Bank / Card clearing account"
    }`,
  ];
  const unpaidLedgerLines = [
    "DR Expense or Inventory account",
    "CR Supplier payable head (AP - supplier), else 2000 Accounts Payable",
  ];

  if (locked) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label>Payment Status</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-xs">
                  Cashier entries are always saved as Unpaid. An accountant or
                  manager reviews them and marks them paid, which posts the Cash
                  credit leg.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>{lockedReason || "Payment status is locked for this entry."}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label>Payment Status</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs space-y-2">
              <p className="font-medium text-xs">
                How status affects the ledger
              </p>
              <ul className="text-xs space-y-1">
                <li>
                  <strong className="text-green-600">Paid</strong> — debits the
                  expense/inventory account and credits Cash or Bank
                  immediately.
                </li>
                <li>
                  <strong className="text-amber-600">Unpaid</strong> — debits
                  the expense/inventory account and credits{" "}
                  the <strong>supplier's own payable head</strong> (auto-created
                  under 2000 Accounts Payable when a supplier is selected),
                  otherwise <strong>2000 Accounts Payable</strong>.
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                When an unpaid bill is later marked paid, a separate settlement
                entry (DR AP · CR Cash) reduces the liability without touching
                the original expense.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Select value={value} onValueChange={(v) => onChange(v as ExpenseStatus)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["paid", "unpaid"] as ExpenseStatus[]).map((s) => {
            const meta = STATUS_META[s];
            const Icon = meta.icon;
            return (
              <SelectItem key={s} value={s}>
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${meta.tone}`} />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{meta.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {meta.short}
                    </span>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {mismatch && (
        <div
          className={
            mismatch.level === "error"
              ? "rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-1.5"
              : "rounded-lg border border-amber-500/30 bg-amber-50 p-3 space-y-1.5 dark:bg-amber-950/20"
          }
          role="alert"
        >
          <p
            className={`flex items-center gap-1.5 text-xs font-medium ${
              mismatch.level === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-300"
            }`}
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {mismatch.title}
          </p>
          <p className="text-xs text-muted-foreground">{mismatch.message}</p>
          <p className="text-xs text-muted-foreground">{mismatch.suggestion}</p>
          {onFixToUnpaid && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onFixToUnpaid}
            >
              Switch to Unpaid (create Accounts Payable)
            </Button>
          )}
        </div>
      )}

      {showLedgerHint && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            {value === "paid" ? "Paid posting" : "Unpaid / credit posting"}
          </p>
          <ul className="text-xs font-mono text-muted-foreground space-y-0.5">
            {(value === "paid" ? paidLedgerLines : unpaidLedgerLines).map(
              (line, i) => (
                <li key={i}>{line}</li>
              )
            )}
          </ul>
          <p className="text-xs text-muted-foreground">
            {value === "paid"
              ? "No Accounts Payable is created because the bill is settled immediately."
              : "Accounts Payable is credited, creating a supplier balance until the bill is settled."}
          </p>
        </div>
      )}
    </div>
  );
}
