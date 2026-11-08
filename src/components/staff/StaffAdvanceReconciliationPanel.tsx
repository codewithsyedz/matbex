import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrency } from "@/hooks/useCurrency";
import {
  reconcileStaffAdvances,
  auditAdvanceReversalIntegrity,
  auditAdvancePostingStatus,
  type AdvanceLedgerLeg,
  type AdvanceSourceRow,
} from "@/lib/staffAdvanceReconciliation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Scale, ShieldCheck, SearchCheck } from "lucide-react";

interface Props {
  advances: AdvanceSourceRow[];
  isLoading?: boolean;
}

export function StaffAdvanceReconciliationPanel({ advances, isLoading }: Props) {
  const { format: money, displayCurrency } = useCurrency();
  const advanceIds = advances.map((a) => a.id);

  const { data: legs = [], isLoading: legsLoading } = useQuery({
    queryKey: ["staff-advance-reconciliation", advanceIds.length, advanceIds[0] ?? null],
    queryFn: async () => {
      if (advanceIds.length === 0) return [];
      const { data, error } = await supabase
        .from("account_transactions")
        .select(
          "reference_id, reference_type, debit, credit, is_voided, chart_of_accounts:account_id(account_code)"
        )
        .in("reference_type", [
          "staff_advance",
          "staff_advance_reversal",
          "staff_advance_repayment",
          "advance_deduction",
        ])
        .in("reference_id", advanceIds);
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        reference_id: row.reference_id as string | null,
        reference_type: row.reference_type as string | null,
        debit: row.debit as number | null,
        credit: row.credit as number | null,
        is_voided: row.is_voided as boolean | null,
        account_code:
          (row.chart_of_accounts as { account_code?: string } | null)?.account_code ?? null,
      })) as AdvanceLedgerLeg[];
    },
    enabled: advanceIds.length > 0,
  });

  const result = reconcileStaffAdvances(advances, legs);
  const mismatches = result.rows.filter((r) => !r.matched);
  const reversalAudit = auditAdvanceReversalIntegrity(advances, legs);
  const postingAudit = auditAdvancePostingStatus(advances, legs);

  if (isLoading || legsLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Ledger reconciliation
            </CardTitle>
            <CardDescription>
              Advances list vs. Employee Advances Receivable (1150) posted in the ledger.
            </CardDescription>
          </div>
          <Badge variant={result.matched ? "default" : "destructive"} className="gap-1">
            {result.matched ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <AlertTriangle className="h-3 w-3" />
            )}
            {result.matched ? "Matched" : "Gap"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Advances list (posted)</p>
            <p className="text-lg font-semibold">{money(result.sourceTotal)}</p>
            <p className="text-xs text-muted-foreground">{result.postedCount} entries</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Ledger net DR 1150</p>
            <p className="text-lg font-semibold">{money(result.ledgerTotal)}</p>
            <p className="text-xs text-muted-foreground">{displayCurrency}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Difference</p>
            <p
              className={`text-lg font-semibold ${
                result.matched ? "text-muted-foreground" : "text-destructive"
              }`}
            >
              {money(result.difference)}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Excluded</p>
            <p className="text-sm font-medium">
              {result.unpostedCount} not posted · {money(result.unpostedTotal)}
            </p>
            <p className="text-xs text-muted-foreground">
              {result.reversedCount} reversed · {money(result.reversedTotal)}
            </p>
          </div>
        </div>

        {mismatches.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="mb-2 font-medium text-destructive">
              {mismatches.length} advance{mismatches.length === 1 ? "" : "s"} do not match the ledger
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {mismatches.slice(0, 5).map((row) => (
                <li key={row.advanceId} className="flex justify-between gap-3">
                  <span className="font-mono">{row.advanceId.slice(0, 8)}</span>
                  <span>
                    list {money(row.sourceAmount)} · ledger {money(row.ledgerAmount)} · diff{" "}
                    {money(row.difference)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div
          className={`rounded-md border p-3 text-sm ${
            postingAudit.clean ? "bg-muted/30" : "border-amber-400/50 bg-amber-50/60"
          }`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium">
              <SearchCheck className="h-4 w-4" />
              Posting status check
            </p>
            <Badge
              variant={
                postingAudit.clean
                  ? "secondary"
                  : postingAudit.criticalCount > 0
                    ? "destructive"
                    : "outline"
              }
            >
              {postingAudit.clean
                ? `${postingAudit.cleanCount} consistent`
                : `${postingAudit.issues.length} flagged`}
            </Badge>
          </div>
          {postingAudit.clean ? (
            <p className="text-xs text-muted-foreground">
              All {postingAudit.checkedCount} advance
              {postingAudit.checkedCount === 1 ? "" : "s"} agree with the ledger: posted flags,
              reversals and recovery all match account 1150.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {postingAudit.criticalCount} critical · {postingAudit.warningCount} warning —
                review these before closing the period.
              </p>
              <ul className="space-y-2 text-xs">
                {postingAudit.issues.slice(0, 8).map((issue) => (
                  <li key={`${issue.advanceId}-${issue.code}`} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">
                        {issue.staffName ?? issue.advanceId.slice(0, 8)} · {issue.title}
                      </span>
                      <Badge
                        variant={issue.severity === "critical" ? "destructive" : "outline"}
                        className="shrink-0"
                      >
                        {issue.severity}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{issue.message}</p>
                    <p className="text-muted-foreground">
                      recorded {money(issue.recordedAmount)} · ledger DR{" "}
                      {money(issue.ledgerPostedAmount)} · ledger recovered{" "}
                      {money(issue.ledgerRecoveredAmount)} · repaid {money(issue.recordedRepaid)}
                    </p>
                  </li>
                ))}
              </ul>
              {postingAudit.issues.length > 8 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  +{postingAudit.issues.length - 8} more flagged advances.
                </p>
              )}
            </>
          )}
        </div>

        {reversalAudit.checkedCount > 0 && (
          <div
            className={`rounded-md border p-3 text-sm ${
              reversalAudit.clean ? "bg-muted/30" : "border-destructive/40 bg-destructive/5"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4" />
                Reversal integrity check
              </p>
              <Badge variant={reversalAudit.clean ? "secondary" : "destructive"}>
                {reversalAudit.clean
                  ? `${reversalAudit.balancedCount} balanced`
                  : `${reversalAudit.issues.length} flagged`}
              </Badge>
            </div>
            {reversalAudit.clean ? (
              <p className="text-xs text-muted-foreground">
                All {reversalAudit.checkedCount} reversed advance
                {reversalAudit.checkedCount === 1 ? "" : "s"} mirror their original posting and net
                to zero on account 1150.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {reversalAudit.issues.slice(0, 5).map((issue) => (
                  <li key={`${issue.advanceId}-${issue.code}`} className="space-y-0.5">
                    <div className="flex justify-between gap-3">
                      <span className="font-mono">{issue.advanceId.slice(0, 8)}</span>
                      <span className="text-muted-foreground">
                        original DR {money(issue.originalDr)} / CR {money(issue.originalCr)} ·
                        reversal DR {money(issue.reversalDr)} / CR {money(issue.reversalCr)} · net{" "}
                        {money(issue.netEffect)}
                      </span>
                    </div>
                    <p className="text-destructive">{issue.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
