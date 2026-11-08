import { Link } from "react-router-dom";
import { Scale, ArrowUpRight, CheckCircle2, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/hooks/useCurrency";
import { useTrialBalance } from "@/hooks/useTrialBalance";
import { cn } from "@/lib/utils";

interface Props {
  from: Date | null;
  to: Date | null;
  /** Concrete branch id, or null/"all" for consolidated. */
  branchId?: string | null;
}

/**
 * Compact trial-balance summary for the Finance Dashboard.
 * Shows totals for the selected period and whether the ledger is balanced.
 */
export function TrialBalanceWidget({ from, to, branchId }: Props) {
  const { format: fmt } = useCurrency();
  const { totals, rows, isLoading } = useTrialBalance({ from, to, branchId });

  const balanced = totals.balanced;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Trial Balance
          </CardTitle>
          <CardDescription>
            Period totals across all active accounts
            {branchId && branchId !== "all" ? " · selected branch" : " · all branches"}
          </CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1">
          <Link to="/reports/trial-balance">
            Open <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Debits</div>
                <div className="text-lg font-semibold tabular-nums">{fmt(totals.debit)}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Credits</div>
                <div className="text-lg font-semibold tabular-nums">{fmt(totals.credit)}</div>
              </div>
            </div>
            <div
              className={cn(
                "rounded-lg border p-3 flex items-center gap-2 text-sm",
                balanced
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              {balanced ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              )}
              <span className="flex-1">
                {balanced
                  ? `Balanced across ${rows.length} active account${rows.length === 1 ? "" : "s"}.`
                  : `Out of balance by ${fmt(Math.abs(totals.diff))}.`}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}