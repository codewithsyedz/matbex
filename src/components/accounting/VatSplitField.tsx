import { AlertTriangle, Info, XCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCurrency } from "@/hooks/useCurrency";
import {
  VAT_ACCOUNT_LABELS,
  type VatAccountKind,
  type VatIssue,
  type VatSplit,
} from "@/lib/vatSplit";

interface VatSplitFieldProps {
  /** Computed split for the amount currently typed in the parent form. */
  split: VatSplit;
  vatEnabled: boolean;
  onVatEnabledChange: (v: boolean) => void;
  inclusive: boolean;
  onInclusiveChange: (v: boolean) => void;
  ratePercent: string;
  onRatePercentChange: (v: string) => void;
  /** Purchases recover input VAT; sales owe output VAT. */
  kind?: VatAccountKind;
  /** Account the net value is debited to, for the posting preview. */
  netAccountLabel?: string;
  disabled?: boolean;
  /** Consistency errors / warnings surfaced inline under the controls. */
  issues?: VatIssue[];
}

/**
 * Net / VAT split control with a live posting preview so the user can see
 * exactly which VAT account the tax portion will land in.
 */
export function VatSplitField({
  split,
  vatEnabled,
  onVatEnabledChange,
  inclusive,
  onInclusiveChange,
  ratePercent,
  onRatePercentChange,
  kind = "input",
  netAccountLabel = "Expense / asset account",
  disabled,
  issues = [],
}: VatSplitFieldProps) {
  const { format: money } = useCurrency();
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm">VAT split</Label>
          <p className="text-[11px] text-muted-foreground">
            Posts the tax portion to {VAT_ACCOUNT_LABELS[kind]}.
          </p>
        </div>
        <Switch
          checked={vatEnabled}
          disabled={disabled}
          onCheckedChange={onVatEnabledChange}
        />
      </div>

      {vatEnabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">VAT rate %</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={ratePercent}
                disabled={disabled}
                onChange={(e) => onRatePercentChange(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Amount entered is</Label>
              <div className="flex h-10 items-center gap-2 rounded-md border bg-background px-3">
                <Switch
                  checked={inclusive}
                  disabled={disabled}
                  onCheckedChange={onInclusiveChange}
                />
                <span className="text-xs text-muted-foreground">
                  {inclusive ? "VAT inclusive" : "VAT exclusive"}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1 rounded-md bg-background p-2 text-xs">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3" />
              Ledger preview
            </div>
            <Row label={`DR ${netAccountLabel} (net)`} value={money(split.net)} />
            <Row
              label={`DR ${VAT_ACCOUNT_LABELS[kind]}`}
              value={money(split.vat)}
            />
            <div className="mt-1 border-t pt-1">
              <Row label="CR Payable / cash (gross)" value={money(split.gross)} strong />
            </div>
          </div>

          {errors.length > 0 && (
            <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
              {errors.map((issue) => (
                <p
                  key={issue.code}
                  className="flex items-start gap-1.5 text-[11px] text-destructive"
                >
                  <XCircle className="mt-[1px] h-3 w-3 shrink-0" />
                  {issue.message}
                </p>
              ))}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
              {warnings.map((issue) => (
                <p
                  key={issue.code}
                  className="flex items-start gap-1.5 text-[11px] text-amber-700"
                >
                  <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
                  {issue.message}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`font-mono ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
