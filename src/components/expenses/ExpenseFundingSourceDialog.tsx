import { useMemo } from "react";
import { Building2, Landmark, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useOwnerCapital } from "@/hooks/useOwnerCapital";
import { selectablePaymentAccounts } from "@/lib/paymentAccountRules";

export type FundingSource = "company" | "owner_capital" | "partner_capital";

export interface FundingSelection {
  fundingSource: FundingSource;
  paymentAccountId: string | null;
  capitalAccountId: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: FundingSelection;
  onChange: (next: FundingSelection) => void;
  /** Called when the user confirms a valid selection. */
  onConfirm?: () => void;
  branchId?: string | null;
}

/** Popup that asks which account funded the expense (company bank/cash, or an owner/partner account). */
export function ExpenseFundingSourceDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onConfirm,
  branchId,
}: Props) {
  const { accounts } = useChartOfAccounts();
  const { summaries } = useOwnerCapital({ branchId: branchId ?? null });

  // Only genuine cash / bank accounts may be credited as the paying account —
  // same rule the database enforces via `is_cash_or_bank_account`.
  const bankAccounts = useMemo(
    () => selectablePaymentAccounts(accounts as any[]),
    [accounts],
  );

  const isCapital = value.fundingSource !== "company";
  const valid = isCapital ? Boolean(value.capitalAccountId) : Boolean(value.paymentAccountId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Which account is paying?</DialogTitle>
          <DialogDescription>
            This decides the credit side of the ledger entry — company cash/bank, or an owner/partner
            capital account when someone paid personally.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: "company", label: "Company", icon: Building2, hint: "Business bank / cash" },
                  { key: "owner_capital", label: "Owner", icon: Landmark, hint: "Owner paid personally" },
                  { key: "partner_capital", label: "Partner", icon: Users, hint: "Partner paid personally" },
                ] as const
              ).map(({ key, label, icon: Icon, hint }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    onChange({
                      fundingSource: key,
                      paymentAccountId: key === "company" ? value.paymentAccountId : null,
                      capitalAccountId: key === "company" ? null : value.capitalAccountId,
                    })
                  }
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    value.fundingSource === key
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-4 w-4 mb-1.5 text-muted-foreground" />
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </button>
              ))}
            </div>

            {!isCapital && (
              <div className="space-y-2">
                <Label>Company bank / cash account</Label>
                <Select
                  value={value.paymentAccountId ?? ""}
                  onValueChange={(v) =>
                    onChange({ ...value, fundingSource: "company", paymentAccountId: v, capitalAccountId: null })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select the paying account" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} · {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {bankAccounts.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No cash or bank accounts found in your chart of accounts.
                  </p>
                )}
              </div>
            )}

            {isCapital && (
              <div className="space-y-2">
                <Label>
                  {value.fundingSource === "owner_capital" ? "Owner" : "Partner"} account (bank)
                </Label>
                <Select
                  value={value.capitalAccountId ?? ""}
                  onValueChange={(v) => onChange({ ...value, paymentAccountId: null, capitalAccountId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select the partner's bank account" />
                  </SelectTrigger>
                  <SelectContent>
                    {summaries.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.partner_name} · {s.bank_name} ••{s.account_last4}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {summaries.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No owner or partner capital accounts yet — create one under Accounting → Owner Capital.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  The ledger will credit this partner's capital account under Equity, recording that the
                  business owes them for the payment.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              onOpenChange(false);
              onConfirm?.();
            }}
          >
            Use this account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ExpenseFundingSourceDialog;
