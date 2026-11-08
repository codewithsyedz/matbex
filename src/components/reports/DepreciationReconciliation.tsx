import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDepreciationReconciliation } from "@/hooks/useDepreciationReconciliation";

interface Props {
  period: string;
  periodEndKey: string;
  periodLabel: string;
  branchId?: string | null;
  branchLabel: string;
  registerPeriodExpense: number;
  registerAccumulated: number;
  fmt: (n: number) => string;
}

export function DepreciationReconciliation({
  period,
  periodEndKey,
  periodLabel,
  branchId,
  branchLabel,
  registerPeriodExpense,
  registerAccumulated,
  fmt,
}: Props) {
  const recon = useDepreciationReconciliation({
    period,
    periodEndKey,
    branchId,
    registerPeriodExpense,
    registerAccumulated,
  });

  const varianceTone = (v: number) =>
    Math.abs(v) <= 0.05 ? "text-muted-foreground" : "text-destructive";

  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            Ledger reconciliation
          </CardTitle>
          <CardDescription className="font-light">
            Register schedule vs posted depreciation expense and accumulated depreciation ·{" "}
            {periodLabel} · {branchLabel}
          </CardDescription>
        </div>
        {recon.isLoading ? null : recon.balanced ? (
          <Badge className="w-fit gap-1 bg-emerald-500/10 font-normal text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Reconciled
          </Badge>
        ) : (
          <Badge variant="destructive" className="w-fit gap-1 font-normal">
            <AlertTriangle className="h-3.5 w-3.5" /> Variance found
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {recon.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Comparison</TableHead>
                    <TableHead className="text-right">Asset register</TableHead>
                    <TableHead className="text-right">General ledger</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <div className="font-medium">Depreciation charge · {periodLabel}</div>
                      <div className="text-xs font-light text-muted-foreground">
                        Debits net of credits on depreciation expense accounts (67xx)
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(recon.registerPeriodExpense)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(recon.ledgerPeriodExpense)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${varianceTone(recon.expenseVariance)}`}
                    >
                      {signed(recon.expenseVariance)}
                    </TableCell>
                    <TableCell className="text-right">
                      {Math.abs(recon.expenseVariance) <= 0.05 ? (
                        <Badge variant="outline" className="font-normal">Match</Badge>
                      ) : (
                        <Badge variant="destructive" className="font-normal">Unposted / drift</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <div className="font-medium">Accumulated depreciation at period end</div>
                      <div className="text-xs font-light text-muted-foreground">
                        Credits net of debits on accumulated depreciation accounts (16xx)
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(recon.registerAccumulated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(recon.ledgerAccumulated)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${varianceTone(recon.accumulatedVariance)}`}
                    >
                      {signed(recon.accumulatedVariance)}
                    </TableCell>
                    <TableCell className="text-right">
                      {Math.abs(recon.accumulatedVariance) <= 0.05 ? (
                        <Badge variant="outline" className="font-normal">Match</Badge>
                      ) : (
                        <Badge variant="destructive" className="font-normal">Unposted / drift</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {!recon.balanced ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm font-light text-muted-foreground">
                A positive variance means the register carries depreciation that has not reached the
                ledger — usually a month that was never posted, a failed depreciation run, or a
                voided journal batch. A negative variance means the ledger holds depreciation
                entries with no matching schedule line, such as a manual journal or a disposal
                posted outside the register.
              </p>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
              <AccountBreakdown
                title="Depreciation expense accounts"
                lines={recon.expenseLines}
                periodLabel={periodLabel}
                fmt={fmt}
              />
              <AccountBreakdown
                title="Accumulated depreciation accounts"
                lines={recon.accumulatedLines}
                periodLabel={periodLabel}
                fmt={fmt}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AccountBreakdown({
  title,
  lines,
  periodLabel,
  fmt,
}: {
  title: string;
  lines: { accountId: string; accountCode: string; accountName: string; periodMovement: number; balanceToDate: number }[];
  periodLabel: string;
  fmt: (n: number) => string;
}) {
  const totalPeriod = lines.reduce((s, l) => s + l.periodMovement, 0);
  const totalBalance = lines.reduce((s, l) => s + l.balanceToDate, 0);
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      {lines.length === 0 ? (
        <p className="text-sm font-light text-muted-foreground">
          No posted entries on these accounts for the selected scope.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[420px]">
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">{periodLabel}</TableHead>
                <TableHead className="text-right">To date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.accountId}>
                  <TableCell>
                    <div className="font-medium">{l.accountCode}</div>
                    <div className="text-xs font-light text-muted-foreground">{l.accountName}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.periodMovement)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmt(l.balanceToDate)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totalPeriod)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totalBalance)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
