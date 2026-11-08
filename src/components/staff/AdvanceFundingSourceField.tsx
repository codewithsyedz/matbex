import { useMemo } from "react";
import { Building2, Landmark, Users } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useOwnerCapital } from "@/hooks/useOwnerCapital";
import { selectablePaymentAccounts } from "@/lib/paymentAccountRules";

export type AdvanceFundingSource = "company" | "owner_capital" | "partner_capital";

export interface AdvanceFundingSelection {
  funding_source: AdvanceFundingSource;
  funding_account_id: string | null;
  capital_account_id: string | null;
}

interface Props {
  value: AdvanceFundingSelection;
  onChange: (next: AdvanceFundingSelection) => void;
  branchId?: string | null;
}

/**
 * Chooses which account pays the staff advance: company cash in hand / bank,
 * or an owner / partner personal (capital) account. Drives the credit leg of
 * the ledger entry — DR 1150 Advances, CR the selected account.
 */
export function AdvanceFundingSourceField({ value, onChange, branchId }: Props) {
  const { accounts } = useChartOfAccounts();
  const { summaries } = useOwnerCapital({ branchId: branchId ?? null });

  const cashAccounts = useMemo(
    () => selectablePaymentAccounts(accounts as any[]),
    [accounts],
  );

  const isCapital = value.funding_source !== "company";

  return (
    <div className="space-y-2">
      <Label>Paid from</Label>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { key: "company", label: "Company", icon: Building2, hint: "Cash in hand / bank" },
            { key: "owner_capital", label: "Owner", icon: Landmark, hint: "Owner personal account" },
            { key: "partner_capital", label: "Partner", icon: Users, hint: "Partner personal account" },
          ] as const
        ).map(({ key, label, icon: Icon, hint }) => (
          <button
            key={key}
            type="button"
            onClick={() =>
              onChange({
                funding_source: key,
                funding_account_id: key === "company" ? value.funding_account_id : null,
                capital_account_id: key === "company" ? null : value.capital_account_id,
              })
            }
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              value.funding_source === key
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <Icon className="mb-1 h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">{label}</p>
            <p className="text-[11px] text-muted-foreground">{hint}</p>
          </button>
        ))}
      </div>

      {!isCapital ? (
        <div className="space-y-1.5">
          <Select
            value={value.funding_account_id ?? ""}
            onValueChange={(v) =>
              onChange({ funding_source: "company", funding_account_id: v, capital_account_id: null })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Cash in hand (1000) — or pick another account" />
            </SelectTrigger>
            <SelectContent>
              {cashAccounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.account_code} · {a.account_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Leave empty to use the default cash account (1000).
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Select
            value={value.capital_account_id ?? ""}
            onValueChange={(v) =>
              onChange({ ...value, funding_account_id: null, capital_account_id: v })
            }
          >
            <SelectTrigger>
              <SelectValue
                placeholder={`Select the ${
                  value.funding_source === "owner_capital" ? "owner's" : "partner's"
                } account`}
              />
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
            <p className="text-[11px] text-muted-foreground">
              No owner or partner accounts yet — create one under Accounting → Owner Capital.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            The advance will credit this capital account under Equity instead of company cash.
          </p>
        </div>
      )}
    </div>
  );
}

export default AdvanceFundingSourceField;
