import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useCurrency } from "@/hooks/useCurrency";
import type { FineCapacity } from "@/hooks/useEmployeeFines";

interface Props {
  capacity: FineCapacity;
  requestedAmount: number;
  staffName?: string;
}

/**
 * Live compliance readout shown while creating or approving a fine.
 * Mirrors the database-side validation so the user sees exactly why a
 * fine can or cannot be approved before they submit it.
 */
export function FineCapacityPanel({ capacity, requestedAmount, staffName }: Props) {
  const { format: fmt } = useCurrency();
  const limit = Number(capacity.monthly_fine_limit) || 0;
  const existing = Number(capacity.existing_fines) || 0;
  const remaining = Number(capacity.remaining_fine_capacity) || 0;
  const perViolation = Number(capacity.max_fine_per_violation) || 0;

  const overSingle = perViolation > 0 && requestedAmount > perViolation;
  const overMonthly = limit > 0 && requestedAmount > remaining;
  const used = limit > 0 ? Math.min(((existing + requestedAmount) / limit) * 100, 100) : 0;

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        Compliance check{staffName ? ` — ${staffName}` : ""}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Monthly wage</span>
        <span className="text-right font-medium">{fmt(Number(capacity.monthly_wage) || 0)}</span>
        <span className="text-muted-foreground">Existing fines this month</span>
        <span className="text-right font-medium">{fmt(existing)}</span>
        <span className="text-muted-foreground">Monthly fine limit</span>
        <span className="text-right font-medium">{limit > 0 ? fmt(limit) : "Not configured"}</span>
        <span className="text-muted-foreground">Max per violation</span>
        <span className="text-right font-medium">
          {perViolation > 0 ? fmt(perViolation) : "Not configured"}
        </span>
        <span className="text-muted-foreground">Remaining allowed fine</span>
        <span className="text-right font-semibold text-primary">{fmt(remaining)}</span>
        <span className="text-muted-foreground">
          Max total deduction ({Number(capacity.max_total_deduction_pct)}% of wage)
        </span>
        <span className="text-right font-medium">{fmt(Number(capacity.max_total_deduction) || 0)}</span>
      </div>

      {limit > 0 && <Progress value={used} className="h-1.5" />}

      {(overSingle || overMonthly) && (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-xs">Fine limit exceeded</AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            {overSingle && (
              <p>
                A single fine cannot exceed {fmt(perViolation)}. Reduce the amount by{" "}
                {fmt(requestedAmount - perViolation)}.
              </p>
            )}
            {overMonthly && (
              <p>
                The entered fine exceeds the remaining monthly limit by{" "}
                {fmt(requestedAmount - remaining)}. Maximum allowed now: {fmt(remaining)}.
              </p>
            )}
            <p className="opacity-80">This fine cannot be approved until the amount is adjusted.</p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}