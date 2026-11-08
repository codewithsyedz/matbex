import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useExplainImbalance } from "@/hooks/usePostingCenter";

interface Props {
  expenseId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ExplainReconcileDrawer({ expenseId, open, onOpenChange }: Props) {
  const { data, isLoading, error } = useExplainImbalance(open ? expenseId : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle>Explain reconcile</SheetTitle>
          <SheetDescription>
            Journal-batch mapping and the exact field diff needed to balance this entry.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6 mt-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading explanation…
            </div>
          ) : error ? (
            <div className="text-sm text-destructive p-4">{(error as any).message}</div>
          ) : !data ? null : (
            <div className="space-y-4 pb-6">
              {/* Expense summary */}
              <section className="rounded-md border p-3">
                <div className="text-xs uppercase text-muted-foreground mb-1">Expense</div>
                <div className="font-medium">
                  {data.expense.description ?? "(no description)"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.expense.expense_date}
                  {data.expense.branch_name && ` · ${data.expense.branch_name}`}
                  {data.expense.account_code &&
                    ` · ${data.expense.account_code} ${data.expense.account_name}`}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Amount</div>
                    <div className="font-semibold tabular-nums">
                      {Number(data.expense.amount).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">DR / CR</div>
                    <div className="tabular-nums">
                      {data.totals.dr_total.toFixed(2)} /{" "}
                      {data.totals.cr_total.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Diff</div>
                    <div className="tabular-nums text-destructive font-medium">
                      {data.totals.diff.toFixed(2)}
                    </div>
                  </div>
                </div>
              </section>

              {/* Journal batches */}
              <section className="rounded-md border p-3">
                <div className="text-xs uppercase text-muted-foreground mb-2">
                  Journal batches ({data.batches.length})
                </div>
                {data.batches.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No journal batch linked.
                  </div>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {data.batches.map((b) => (
                      <li key={b.batch_id} className="flex justify-between gap-2">
                        <span className="font-mono">{b.batch_number ?? b.batch_id.slice(0, 8)}</span>
                        <span className="text-muted-foreground truncate">
                          {b.description}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {b.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Existing legs */}
              <section className="rounded-md border">
                <div className="text-xs uppercase text-muted-foreground p-3 pb-1">
                  Existing legs
                </div>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-t">
                      <th className="text-left px-3 py-1">Account</th>
                      <th className="text-right px-3 py-1">DR</th>
                      <th className="text-right px-3 py-1">CR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.legs.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-3 py-1">
                          <span className="font-mono">{l.account_code}</span>{" "}
                          {l.account_name}
                          {l.is_voided && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              voided
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          {l.debit != null ? Number(l.debit).toFixed(2) : ""}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          {l.credit != null ? Number(l.credit).toFixed(2) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* Suggested fix */}
              <section className="rounded-md border p-3 bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  {data.suggested_fix.fixable_automatically ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                  <div className="text-sm font-medium">Suggested fix</div>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {data.suggested_fix.pattern.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="text-sm">{data.suggested_fix.proposed_action}</p>
                <div className="text-xs text-muted-foreground mt-2">
                  Affects fields:{" "}
                  <span className="font-mono">
                    {data.suggested_fix.fields.join(", ")}
                  </span>
                </div>
                {data.suggested_fix.credit_account && (
                  <div className="text-xs mt-1">
                    Counter account:{" "}
                    <span className="font-mono">
                      {data.suggested_fix.credit_account.account_code}
                    </span>{" "}
                    {data.suggested_fix.credit_account.account_name}
                  </div>
                )}
                {data.suggested_fix.credit_amount != null && (
                  <div className="text-xs mt-1">
                    Field diff:{" "}
                    <span className="tabular-nums font-medium">
                      CR +{Number(data.suggested_fix.credit_amount).toFixed(2)}
                    </span>
                  </div>
                )}
              </section>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}