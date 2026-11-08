import { useState } from "react";
import { ChevronDown, Calculator, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useCurrency } from "@/hooks/useCurrency";
import { useOverheadData } from "@/hooks/useOverheadData";

interface Props {
  /** Amount actually being finalized (may be manually overridden). */
  effectiveAmount?: number;
  isLocked?: boolean;
}

function Row({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className={strong ? "text-sm font-medium" : "text-sm"}>{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <p className={`shrink-0 tabular-nums ${strong ? "text-sm font-semibold" : "text-sm"}`}>{value}</p>
    </div>
  );
}

export default function OverheadDayBreakdown({ effectiveAmount, isLocked }: Props) {
  const { format: formatCurrency } = useCurrency();
  const { data, isLoading } = useOverheadData();
  const [open, setOpen] = useState(false);

  if (isLoading || !data) {
    return <Skeleton className="h-24 w-full" />;
  }

  const suggested = data.dailyOverhead;
  const overridden =
    typeof effectiveAmount === "number" && Math.abs(effectiveAmount - suggested) > 0.005;
  const unpaidItems = data.items.filter(i => !i.is_paid);
  const paidItems = data.items.filter(i => i.is_paid);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">How Overhead / Day was calculated</p>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(data.totalOverhead)} unpaid monthly overhead ÷ {data.totalDays} days ={" "}
                {formatCurrency(suggested)} / day
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {overridden && <Badge variant="outline" className="text-amber-600 dark:text-amber-400">Manual override</Badge>}
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-3 border-t p-4">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              1 · Fixed overhead still unpaid this fiscal month
            </p>
            {unpaidItems.length === 0 ? (
              <p className="py-1.5 text-sm text-muted-foreground">No unpaid overhead items.</p>
            ) : (
              unpaidItems.map(item => (
                <Row
                  key={item.id}
                  label={item.name}
                  hint={`${formatCurrency(item.fiscal_daily_amount ?? 0)} / day`}
                  value={formatCurrency(item.monthly_amount)}
                />
              ))
            )}
            <Separator className="my-2" />
            <Row label="Fixed overhead subtotal" value={formatCurrency(data.fixedOverhead)} strong />
            {paidItems.length > 0 && (
              <p className="pt-1 text-xs text-muted-foreground">
                Excluded: {paidItems.length} item{paidItems.length > 1 ? "s" : ""} already paid
                ({formatCurrency(data.paidOverheadTotal)}) — paid items are expensed directly, not accrued again.
              </p>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              2 · Payroll still payable
            </p>
            <Row
              label="Gross payroll"
              hint={`${data.staffCount} staff in scope`}
              value={formatCurrency(data.grossPayroll)}
            />
            <Row label="Less pending staff advances" value={`- ${formatCurrency(data.pendingAdvances)}`} />
            <Row
              label="Less payroll already paid"
              hint={`${data.paidStaffCount} staff paid this period`}
              value={`- ${formatCurrency(data.paidPayroll)}`}
            />
            <Separator className="my-2" />
            <Row label="Payroll payable subtotal" value={formatCurrency(data.totalPayable)} strong />
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              3 · Daily allocation
            </p>
            <Row label="Total unpaid overhead" value={formatCurrency(data.totalOverhead)} />
            <Row label="Days in fiscal month" value={String(data.totalDays)} />
            <Separator className="my-2" />
            <Row label="Suggested Overhead / Day" value={formatCurrency(suggested)} strong />
            {typeof effectiveAmount === "number" && (
              <Row
                label={isLocked ? "Finalized amount" : "Amount to be finalized"}
                hint={overridden ? `Differs from suggestion by ${formatCurrency(Math.abs(effectiveAmount - suggested))}` : undefined}
                value={formatCurrency(effectiveAmount)}
                strong
              />
            )}
          </div>

          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Values are scoped to the active branch (shared tenant-wide items included) and the current
              fiscal month. Finalizing posts DR Daily Overhead Allocation · CR Accrued Expenses for this amount.
            </p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
