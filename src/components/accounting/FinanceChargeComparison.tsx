import { ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface FinanceChargeComparisonAsset {
  name: string;
  netBookValue: number;
  monthlyDepreciation: number;
  monthsRemaining: number;
}

interface Props {
  /** Current (saved) values */
  currentFinanceCharge: number;
  currentTotalPayable: number;
  currentInstallmentCount: number;
  /** Proposed values from the edit form */
  nextFinanceCharge: number;
  nextInstallmentCount: number;
  /** Derived plan state */
  cashPrice: number;
  paidAmount: number;
  paidCount: number;
  money: (v: number) => string;
  asset?: FinanceChargeComparisonAsset | null;
}

interface Row {
  label: string;
  before: string;
  after: string;
  delta?: number;
  hint?: string;
  isCount?: boolean;
}

export function FinanceChargeComparison({
  currentFinanceCharge,
  currentTotalPayable,
  currentInstallmentCount,
  nextFinanceCharge,
  nextInstallmentCount,
  cashPrice,
  paidAmount,
  paidCount,
  money,
  asset,
}: Props) {
  const chargeBefore = Number(currentFinanceCharge || 0);
  const chargeAfter = Number.isFinite(nextFinanceCharge) ? Number(nextFinanceCharge) : chargeBefore;
  const totalBefore = Number(currentTotalPayable || 0);
  const totalAfter = totalBefore - chargeBefore + chargeAfter;

  const outstandingBefore = Math.max(totalBefore - paidAmount, 0);
  const outstandingAfter = Math.max(totalAfter - paidAmount, 0);

  const remainingBefore = Math.max(currentInstallmentCount - paidCount, 0);
  const remainingAfter = Math.max(
    (Number.isFinite(nextInstallmentCount) ? nextInstallmentCount : currentInstallmentCount) - paidCount,
    0,
  );

  const perBefore = remainingBefore > 0 ? outstandingBefore / remainingBefore : 0;
  const perAfter = remainingAfter > 0 ? outstandingAfter / remainingAfter : 0;

  const rows: Row[] = [
    { label: "Finance charge", before: money(chargeBefore), after: money(chargeAfter), delta: chargeAfter - chargeBefore },
    { label: "Total payable", before: money(totalBefore), after: money(totalAfter), delta: totalAfter - totalBefore },
    {
      label: "Outstanding balance",
      before: money(outstandingBefore),
      after: money(outstandingAfter),
      delta: outstandingAfter - outstandingBefore,
      hint: `${money(paidAmount)} already settled`,
    },
    {
      label: "Remaining installments",
      before: String(remainingBefore),
      after: String(remainingAfter),
      delta: remainingAfter - remainingBefore,
      isCount: true,
    },
    {
      label: "Per-installment amount",
      before: money(perBefore),
      after: money(perAfter),
      delta: perAfter - perBefore,
    },
  ];

  const bookRows: Row[] = [
    {
      label: "Capitalized asset cost",
      before: money(cashPrice),
      after: money(cashPrice),
      delta: 0,
      hint: "Finance charge is expensed, never capitalized",
    },
  ];
  if (asset) {
    bookRows.push(
      {
        label: `Net book value — ${asset.name}`,
        before: money(asset.netBookValue),
        after: money(asset.netBookValue),
        delta: 0,
      },
      {
        label: "Monthly depreciation",
        before: money(asset.monthlyDepreciation),
        after: money(asset.monthlyDepreciation),
        delta: 0,
        hint: `${asset.monthsRemaining} month(s) remaining`,
      },
    );
  }

  const renderRow = (r: Row) => {
    const delta = r.delta ?? 0;
    const flat = Math.abs(delta) < 0.005;
    return (
      <div key={r.label} className="grid grid-cols-[1fr_auto] gap-2 py-2 border-b border-border/60 last:border-0">
        <div>
          <p className="text-sm">{r.label}</p>
          {r.hint && <p className="text-[11px] text-muted-foreground">{r.hint}</p>}
        </div>
        <div className="flex items-center gap-2 text-sm tabular-nums">
          <span className="text-muted-foreground line-through decoration-muted-foreground/40">{r.before}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{r.after}</span>
          <Badge
            variant="outline"
            className={
              flat
                ? "text-muted-foreground"
                : delta > 0
                ? "text-destructive border-destructive/30 bg-destructive/5"
                : "text-success border-success/30 bg-success/5"
            }
          >
            {flat ? (
              <Minus className="h-3 w-3" />
            ) : delta > 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            <span className="ml-1">{flat ? "no change" : `${delta > 0 ? "+" : "−"}${r.isCount ? Math.abs(delta) : money(Math.abs(delta))}`}</span>
          </Badge>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      <div>
        <p className="text-sm font-medium">Before / after</p>
        <p className="text-[11px] text-muted-foreground">
          Preview of the recalculated schedule. The finance-charge difference is posted as a balanced ledger adjustment.
        </p>
      </div>
      <div>{rows.map(renderRow)}</div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Book values</p>
        {bookRows.map(renderRow)}
      </div>
    </div>
  );
}
