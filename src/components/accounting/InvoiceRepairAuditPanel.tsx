import { useState } from "react";
import { format } from "date-fns";
import { ArrowRight, ChevronDown, History, RefreshCw, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useInvoiceRepairAudit,
  type InvoiceRepairAuditRow,
} from "@/hooks/useInvoiceRepairAudit";

interface Props {
  /** Optional callback to open the invoice drilldown for a repaired bill. */
  onInspectInvoice?: (invoiceId: string) => void;
}

/**
 * Immutable trail of every automated or manual invoice / ledger repair:
 * before and after amounts, the timestamp and actor, and the rule that fired.
 */
export function InvoiceRepairAuditPanel({ onInspectInvoice }: Props) {
  const { format: fmt } = useCurrency();
  const { data: rows = [], isLoading, isFetching, refetch } = useInvoiceRepairAudit();
  const [openRow, setOpenRow] = useState<string | null>(null);

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <History className="h-4 w-4" />
              Repair audit trail
              <Badge variant="outline">{rows.length}</Badge>
            </CardTitle>
            <CardDescription>
              Every repaired invoice or ledger posting with the amounts before and after, when it
              ran, who ran it, and the correction rule that triggered it.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No invoice or ledger repairs have been recorded yet.
          </p>
        ) : (
          rows.map((r) => (
            <RepairRow
              key={r.id}
              row={r}
              open={openRow === r.id}
              onOpenChange={(o) => setOpenRow(o ? r.id : null)}
              fmt={fmt}
              onInspectInvoice={onInspectInvoice}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function RepairRow({
  row,
  open,
  onOpenChange,
  fmt,
  onInspectInvoice,
}: {
  row: InvoiceRepairAuditRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fmt: (n: number) => string;
  onInspectInvoice?: (invoiceId: string) => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-md border">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-auto w-full justify-start gap-3 px-3 py-2 text-left">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1 text-xs">
              <span className="font-medium">
                {row.invoiceNumber ?? "Invoice"}
                {row.supplierName ? ` · ${row.supplierName}` : ""}
              </span>
              <span className="ml-2 text-muted-foreground">
                {format(new Date(row.createdAt), "MMM d, yyyy HH:mm")}
                {row.performedBy ? ` · ${row.performedBy}` : ""}
              </span>
            </span>
            <Delta before={row.before.invoiceTotal} after={row.after.invoiceTotal} fmt={fmt} />
            {row.needsLedgerRepost && (
              <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
                needs repost
              </Badge>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t p-3 text-xs">
          <div className="rounded-md bg-muted/30 p-2">
            <p className="font-medium">Rule triggered</p>
            <p className="text-muted-foreground">{row.ruleLabel}</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{row.action}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <AmountDelta
              label="Bill total"
              before={row.before.invoiceTotal}
              after={row.after.invoiceTotal}
              fmt={fmt}
            />
            <AmountDelta
              label="Linked expense"
              before={row.before.expenseAmount}
              after={row.after.expenseAmount}
              fmt={fmt}
            />
            <AmountDelta
              label="Ledger debit"
              before={row.before.ledgerDebit}
              after={row.after.ledgerDebit}
              fmt={fmt}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {row.removedLines} duplicate line{row.removedLines === 1 ? "" : "s"} removed
            </Badge>
            {row.raw.new.replacement_batch_id && (
              <Badge variant="outline" className="font-mono text-[10px]">
                batch {String(row.raw.new.replacement_batch_id).slice(0, 8)}…
              </Badge>
            )}
          </div>

          {row.duplicateGroups.length > 0 && (
            <div className="rounded-md bg-muted/30 p-2">
              <p className="mb-1 font-medium">Lines that triggered the correction</p>
              {row.duplicateGroups.map((g, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="truncate text-muted-foreground">
                    {g.description ?? "—"}
                    {g.occurrences ? ` ×${g.occurrences}` : ""}
                  </span>
                  <span className="font-mono tabular-nums">
                    {fmt(Number(g.excess_amount ?? g.line_total ?? g.amount ?? 0))}
                  </span>
                </div>
              ))}
            </div>
          )}

          {row.entityId && onInspectInvoice && (
            <Button variant="outline" size="sm" onClick={() => onInspectInvoice(row.entityId!)}>
              View invoice lines
            </Button>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function Delta({
  before,
  after,
  fmt,
}: {
  before: number | null;
  after: number | null;
  fmt: (n: number) => string;
}) {
  if (before == null || after == null) return null;
  return (
    <span className="hidden shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums sm:flex">
      <span className="text-muted-foreground line-through">{fmt(before)}</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span>{fmt(after)}</span>
    </span>
  );
}

function AmountDelta({
  label,
  before,
  after,
  fmt,
}: {
  label: string;
  before: number | null;
  after: number | null;
  fmt: (n: number) => string;
}) {
  const changed = before != null && after != null && Math.abs(before - after) > 0.005;
  return (
    <div className="rounded-md bg-muted/30 p-2">
      <p className="mb-1 font-medium">{label}</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Before</span>
        <span className="font-mono tabular-nums">{before == null ? "—" : fmt(before)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">After</span>
        <span className={`font-mono tabular-nums ${changed ? "text-emerald-600" : ""}`}>
          {after == null ? "—" : fmt(after)}
        </span>
      </div>
    </div>
  );
}