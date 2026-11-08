import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { History, Loader2, ArrowRight } from "lucide-react";
import {
  useExpenseAmendmentAudit,
  type AmendmentLedgerLine,
  type ExpenseAmendmentAuditEntry,
} from "@/hooks/useExpenseAmendmentAudit";

interface Props {
  expenseId: string | null | undefined;
}

const FIELD_LABELS: Record<string, string> = {
  amount: "Amount",
  vat_amount: "VAT amount",
  expense_date: "Expense date",
  description: "Description",
  category_id: "Category",
  account_id: "Expense account",
  supplier_id: "Supplier",
};

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toFixed(2);
  return String(value);
}

/** Read-only audit trail of every posted amendment for one expense. */
export function ExpenseAmendmentAuditPanel({ expenseId }: Props) {
  const { data = [], isLoading } = useExpenseAmendmentAudit(expenseId);

  if (!expenseId) return null;

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading amendment history…
      </div>
    );
  }

  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Amendment audit trail</span>
        <Badge variant="outline" className="text-[10px] py-0 px-1">
          {data.length} amendment{data.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <ScrollArea className="max-h-[360px] pr-2">
        <div className="space-y-3">
          {data.map((entry) => (
            <AmendmentEntry key={entry.id} entry={entry} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function AmendmentEntry({ entry }: { entry: ExpenseAmendmentAuditEntry }) {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-muted/40">
        <div className="text-xs">
          <span className="font-medium">
            {entry.amendedByName ?? "Unknown user"}
          </span>{" "}
          <span className="text-muted-foreground">
            · {new Date(entry.amended_at).toLocaleString()}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {entry.reversed_line_count} row
          {entry.reversed_line_count === 1 ? "" : "s"} reversed
        </div>
      </div>

      <div className="px-3 py-2 space-y-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Reason:</span>{" "}
          {entry.reason}
        </p>

        {entry.changed_fields.length > 0 && (
          <div className="space-y-1">
            {entry.changed_fields.map((f) => (
              <div key={f} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 text-muted-foreground">
                  {FIELD_LABELS[f] ?? f}
                </span>
                <span className="truncate">{fmt(entry.before_values?.[f])}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">
                  {fmt(entry.after_values?.[f])}
                </span>
              </div>
            ))}
          </div>
        )}

        <LedgerLines title="Reversed ledger rows" lines={entry.reversed_lines} />
        <LedgerLines title="Re-posted ledger rows" lines={entry.new_lines} />
      </div>
    </div>
  );
}

function LedgerLines({
  title,
  lines,
}: {
  title: string;
  lines: AmendmentLedgerLine[];
}) {
  if (!lines || lines.length === 0) return null;
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="px-3 py-1 text-[11px] font-medium bg-muted/30">{title}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-7 text-[11px]">Date</TableHead>
            <TableHead className="h-7 text-[11px]">Account</TableHead>
            <TableHead className="h-7 text-[11px] text-right">Debit</TableHead>
            <TableHead className="h-7 text-[11px] text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l, i) => (
            <TableRow key={l.transaction_id ?? i}>
              <TableCell className="py-1 text-[11px] tabular-nums">
                {l.transaction_date ?? "—"}
              </TableCell>
              <TableCell className="py-1 text-[11px]">
                <span className="font-mono">{l.account_code ?? "—"}</span>{" "}
                {l.account_name ?? ""}
              </TableCell>
              <TableCell className="py-1 text-[11px] text-right tabular-nums">
                {Number(l.debit ?? 0) > 0 ? Number(l.debit).toFixed(2) : ""}
              </TableCell>
              <TableCell className="py-1 text-[11px] text-right tabular-nums">
                {Number(l.credit ?? 0) > 0 ? Number(l.credit).toFixed(2) : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
