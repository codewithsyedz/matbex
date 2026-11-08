import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Layers } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { useCurrency } from "@/hooks/useCurrency";
import { useLedgerImbalance } from "@/hooks/useLedgerImbalance";
import type { AccountType } from "@/hooks/useChartOfAccounts";

const TYPE_LABEL: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  expense: "Operating Expenses",
};

interface Props {
  from: Date | null;
  to: Date | null;
}

/**
 * Shows what's driving a trial-balance imbalance:
 * per-type net diff and any unbalanced journal batches.
 */
export function ImbalanceBreakdown({ from, to }: Props) {
  const { format: fmt } = useCurrency();
  const { typeDiffs, unbalancedBatches, isLoading } = useLedgerImbalance({ from, to });
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Imbalance breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  const nonZeroTypeDiffs = typeDiffs.filter((t) => Math.abs(t.diff) >= 0.01);
  const topBatches = unbalancedBatches.slice(0, 10);

  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Imbalance breakdown
        </CardTitle>
        <CardDescription>
          Pinpoints which account types and journal batches are driving the difference between total
          debits and credits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Per account-type diffs */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            By account type
          </h4>
          {nonZeroTypeDiffs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every account type nets to zero - the imbalance comes from individual batches below.
            </p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account type</TableHead>
                    <TableHead className="text-right">Debits</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nonZeroTypeDiffs.map((t) => (
                    <TableRow key={t.type}>
                      <TableCell>{TYPE_LABEL[t.type]}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(t.totalDebit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(t.totalCredit)}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums font-semibold",
                          t.diff > 0 ? "text-emerald-600" : "text-destructive",
                        )}
                      >
                        {t.diff > 0 ? "+" : ""}
                        {fmt(t.diff)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Unbalanced batches */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Unbalanced journal batches
            {unbalancedBatches.length > 0 && (
              <Badge variant="destructive" className="ml-1">
                {unbalancedBatches.length}
              </Badge>
            )}
          </h4>
          {unbalancedBatches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No unbalanced batches in this period. The imbalance is structural - check the per-type
              diffs above against your chart of accounts setup.
            </p>
          ) : (
            <ScrollArea className="h-[40vh] rounded-md border">
              <div className="divide-y">
                {topBatches.map((b) => {
                  const key = b.batchId ?? `orphan-${b.date}-${b.diff}`;
                  const isOpen = expandedBatch === key;
                  return (
                    <Collapsible
                      key={key}
                      open={isOpen}
                      onOpenChange={(o) => setExpandedBatch(o ? key : null)}
                    >
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="w-full px-3 py-2.5 flex items-start gap-2 text-left hover:bg-muted/40"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap text-sm">
                              <span className="font-mono text-xs tabular-nums">{b.date}</span>
                              {b.referenceType && (
                                <Badge variant="outline" className="text-[10px]">
                                  {b.referenceType}
                                </Badge>
                              )}
                              {!b.batchId && (
                                <Badge variant="outline" className="text-[10px]">
                                  no batch
                                </Badge>
                              )}
                              <span className="text-muted-foreground truncate">
                                {b.description ?? "-"}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                              {b.rowCount} row{b.rowCount === 1 ? "" : "s"} · D {fmt(b.totalDebit)} ·
                              C {fmt(b.totalCredit)}
                            </div>
                          </div>
                          <div
                            className={cn(
                              "text-sm font-semibold tabular-nums whitespace-nowrap",
                              b.diff > 0 ? "text-emerald-600" : "text-destructive",
                            )}
                          >
                            {b.diff > 0 ? "+" : ""}
                            {fmt(b.diff)}
                          </div>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="px-3 pb-3 pl-9">
                        <div className="rounded border bg-muted/20">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="h-8 text-xs">Account</TableHead>
                                <TableHead className="h-8 text-xs text-right">Debit</TableHead>
                                <TableHead className="h-8 text-xs text-right">Credit</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {b.accounts.map((a) => (
                                <TableRow key={a.accountId}>
                                  <TableCell className="py-1.5 text-xs">
                                    <span className="font-mono text-muted-foreground mr-1.5">
                                      {a.code}
                                    </span>
                                    {a.name}
                                  </TableCell>
                                  <TableCell className="py-1.5 text-xs text-right tabular-nums">
                                    {a.debit > 0 ? fmt(a.debit) : "-"}
                                  </TableCell>
                                  <TableCell className="py-1.5 text-xs text-right tabular-nums">
                                    {a.credit > 0 ? fmt(a.credit) : "-"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
                {unbalancedBatches.length > topBatches.length && (
                  <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                    Showing top 10 of {unbalancedBatches.length} unbalanced batches.
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </CardContent>
    </Card>
  );
}