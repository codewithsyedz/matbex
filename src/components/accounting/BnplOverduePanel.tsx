import { useState } from "react";
import { AlertTriangle, CheckCircle2, History, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { useCurrency } from "@/hooks/useCurrency";
import {
  useBnplOverdue,
  useInstallmentPaymentAudit,
  useQuickPayInstallment,
  type OverdueInstallment,
} from "@/hooks/useBnplOverdue";

const severity = (days: number) =>
  days > 60
    ? "bg-destructive/15 text-destructive"
    : days > 30
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-muted text-muted-foreground";

export function BnplOverduePanel({ branchId }: { branchId?: string | null }) {
  const { format: money } = useCurrency();
  const { data: overdue = [], isLoading } = useBnplOverdue(branchId);
  const { data: audit = [] } = useInstallmentPaymentAudit(20);
  const quickPay = useQuickPayInstallment();

  const [confirming, setConfirming] = useState<OverdueInstallment | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const total = overdue.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const handleConfirm = async () => {
    if (!confirming) return;
    try {
      await quickPay.mutateAsync({ installmentId: confirming.installment_id });
      toast.success(
        `Installment ${confirming.installment_no} marked as paid and posted to the ledger`,
      );
      setConfirming(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not mark the installment as paid");
    }
  };

  return (
    <>
      <Card className={overdue.length ? "border-destructive/30" : undefined}>
        <CardHeader className="flex-row items-start justify-between space-y-0 gap-3 pb-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <AlertTriangle className={`h-4 w-4 ${overdue.length ? "text-destructive" : "text-muted-foreground"}`} />
              Overdue installments
            </CardTitle>
            <CardDescription>
              {overdue.length
                ? `${overdue.length} payment${overdue.length === 1 ? "" : "s"} past due · ${money(total)} — reminders are sent daily to owners, managers and accountants.`
                : "Nothing past due. Daily reminders will alert you if that changes."}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setAuditOpen((v) => !v)}>
            <History className="h-4 w-4 mr-2" />
            Audit log
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : overdue.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" /> All installments are on schedule.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Overdue</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdue.map((r) => (
                    <TableRow key={r.installment_id}>
                      <TableCell className="font-medium">
                        {r.description}{" "}
                        <span className="text-muted-foreground">#{r.installment_no}</span>
                      </TableCell>
                      <TableCell>{r.provider}</TableCell>
                      <TableCell>{r.supplier_name ?? "-"}</TableCell>
                      <TableCell>{r.due_date}</TableCell>
                      <TableCell className="text-right">{money(Number(r.amount) || 0)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={severity(r.days_overdue)}>
                          {r.days_overdue}d
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={quickPay.isPending}
                          onClick={() => setConfirming(r)}
                        >
                          {quickPay.isPending && quickPay.variables?.installmentId === r.installment_id ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                          )}
                          Mark paid
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
            <CollapsibleTrigger asChild>
              <span />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium">Recent installment payment activity</p>
                {audit.length === 0 && (
                  <p className="text-sm text-muted-foreground">No installment payment activity recorded yet.</p>
                )}
                {audit.map((a) => (
                  <div key={a.id} className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                    <span className="text-foreground font-medium">
                      {a.action === "installment_payment_voided" ? "Voided" : "Marked paid"}
                    </span>
                    <span>#{a.new_data?.installment_no ?? "?"}</span>
                    <span>{a.new_data?.paid_date ?? a.new_data?.due_date ?? ""}</span>
                    <span>{money(Number(a.new_data?.paid_amount ?? a.new_data?.amount ?? 0))}</span>
                    <span>· {new Date(a.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      <AlertDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark installment as paid?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming && (
                <>
                  Installment #{confirming.installment_no} of “{confirming.description}” for{" "}
                  {money(Number(confirming.amount) || 0)} will be settled today from the default company
                  cash/bank account and posted to the ledger (DR BNPL payable / CR cash). The action is
                  recorded in the audit log.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={quickPay.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleConfirm(); }} disabled={quickPay.isPending}>
              {quickPay.isPending ? "Posting…" : "Mark as paid"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default BnplOverduePanel;
