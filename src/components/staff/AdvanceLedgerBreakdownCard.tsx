import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrency } from "@/hooks/useCurrency";
import {
  buildAdvanceLedgerBreakdown,
  describeFundingAccounts,
  legKindLabel,
  type BreakdownLeg,
} from "@/lib/advanceLedgerBreakdown";

interface Props {
  legs: BreakdownLeg[];
}

/**
 * Per-account view of everything posted for a staff advance: which account was
 * credited (the funding source), which was debited, and the net per account.
 */
export function AdvanceLedgerBreakdownCard({ legs }: Props) {
  const { format: money, displayCurrency } = useCurrency();
  const breakdown = buildAdvanceLedgerBreakdown(legs);

  if (!breakdown.rows.length) return null;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Account breakdown</p>
          <p className="text-xs text-muted-foreground">
            Net movement per account across every journal line for this advance.
          </p>
        </div>
        <Badge variant={breakdown.balanced ? "default" : "destructive"} className="gap-1">
          <Scale className="h-3 w-3" />
          {breakdown.balanced ? "Balanced" : "Out of balance"}
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md bg-muted/50 p-2.5">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowUpRight className="h-3 w-3" />
            Credited (money out of)
          </p>
          <p className="text-sm font-medium">{describeFundingAccounts(breakdown)}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-2.5">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowDownLeft className="h-3 w-3" />
            Debited (receivable)
          </p>
          <p className="text-sm font-medium">
            {breakdown.debitedAccounts.length
              ? breakdown.debitedAccounts
                  .map((r) => `${r.accountCode} · ${r.accountName}`)
                  .join(", ")
              : "—"}
          </p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Lines</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
            <TableHead className="text-right">Net</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {breakdown.rows.map((row) => (
            <TableRow key={row.accountCode}>
              <TableCell>
                <p className="font-medium">
                  {row.accountCode} · {row.accountName}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.kinds.map((kind) => (
                    <Badge key={kind} variant="outline" className="text-[10px]">
                      {legKindLabel(kind)}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{row.legCount}</TableCell>
              <TableCell className="text-right">
                {row.debit > 0 ? money(row.debit) : "—"}
              </TableCell>
              <TableCell className="text-right">
                {row.credit > 0 ? money(row.credit) : "—"}
              </TableCell>
              <TableCell className="text-right font-medium">
                {row.side === "none" ? (
                  <span className="text-muted-foreground">Settled</span>
                ) : (
                  <>
                    {money(Math.abs(row.net))}{" "}
                    <span className="text-xs text-muted-foreground">
                      {row.side === "debit" ? "DR" : "CR"}
                    </span>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/50 font-medium">
            <TableCell colSpan={2}>Total ({displayCurrency})</TableCell>
            <TableCell className="text-right">{money(breakdown.totalDebit)}</TableCell>
            <TableCell className="text-right">{money(breakdown.totalCredit)}</TableCell>
            <TableCell className="text-right">
              {breakdown.balanced ? "0.00" : money(breakdown.totalDebit - breakdown.totalCredit)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      {breakdown.voidedLegCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {breakdown.voidedLegCount} voided line
          {breakdown.voidedLegCount === 1 ? "" : "s"} excluded from these totals.
        </p>
      )}
    </div>
  );
}
