import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle, Receipt, ChevronDown, Wand2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/contexts/AuthContext";
import { InstallmentVatCorrectionDialog } from "@/components/accounting/InstallmentVatCorrectionDialog";
import {
  breakdownInstallmentVat,
  isInputVatAccount,
  reconcileVatRecoverable,
  sumInstallmentVat,
} from "@/lib/vatRecoverableReconciliation";

interface Props {
  restaurantId?: string;
  /** Inclusive ISO dates (yyyy-MM-dd). */
  dateFrom: string;
  dateTo: string;
  branchId?: string | null;
}

/**
 * Summarises Input VAT Recoverable by journal batch and proves the ledger
 * total equals the VAT captured on the source documents (expenses + purchase
 * invoices) for the same period.
 */
export function VatRecoverableReconciliationPanel({
  restaurantId,
  dateFrom,
  dateTo,
  branchId = null,
}: Props) {
  const { format: formatCurrency } = useCurrency();
  const { isOwner, isAccountant } = useAuth() as any;
  const [correctionPlanId, setCorrectionPlanId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["vat-recoverable-recon", restaurantId, dateFrom, dateTo, branchId],
    enabled: !!restaurantId && !!dateFrom && !!dateTo,
    queryFn: async () => {
      const { data: accounts, error: accErr } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name")
        .eq("tenant_id", restaurantId!);
      if (accErr) throw accErr;

      const vatAccounts = (accounts ?? []).filter((a: any) =>
        isInputVatAccount(a.account_code, a.account_name),
      );
      const accountIds = vatAccounts.map((a: any) => a.id);
      const accountById = new Map(vatAccounts.map((a: any) => [a.id, a]));

      let lines: any[] = [];
      if (accountIds.length) {
        let q = supabase
          .from("account_transactions")
          .select("batch_id, account_id, debit, credit, transaction_date, is_voided")
          .eq("tenant_id", restaurantId!)
          .in("account_id", accountIds)
          .gte("transaction_date", dateFrom)
          .lte("transaction_date", dateTo);
        if (branchId) q = q.eq("branch_id", branchId);
        const { data: txns, error: txErr } = await q;
        if (txErr) throw txErr;
        lines = (txns ?? []).map((t: any) => ({
          ...t,
          account_code: accountById.get(t.account_id)?.account_code,
          account_name: accountById.get(t.account_id)?.account_name,
        }));
      }

      const batchIds = [...new Set(lines.map((l) => l.batch_id).filter(Boolean))] as string[];
      let batches: any[] = [];
      if (batchIds.length) {
        const { data: b, error: bErr } = await supabase
          .from("journal_entry_batches")
          .select("id, reference_number, journal_type, batch_date, is_posted")
          .in("id", batchIds);
        if (bErr) throw bErr;
        batches = b ?? [];
      }

      let expQ = supabase
        .from("expenses")
        .select("vat_amount")
        .eq("restaurant_id", restaurantId!)
        .is("deleted_at", null)
        .gte("expense_date", dateFrom)
        .lte("expense_date", dateTo);
      if (branchId) expQ = expQ.eq("branch_id", branchId);

      let instQ = (supabase as any)
        .from("installment_plans")
        .select(
          "id, description, supplier_name, provider, purchase_date, branch_id, vat_amount, finance_vat_amount, status",
        )
        .eq("tenant_id", restaurantId!)
        .gte("purchase_date", dateFrom)
        .lte("purchase_date", dateTo);
      if (branchId) instQ = instQ.eq("branch_id", branchId);

      const [expRes, purRes, instRes] = await Promise.all([
        expQ,
        supabase
          .from("purchase_invoices")
          .select("tax_amount")
          .eq("restaurant_id", restaurantId!)
          .gte("invoice_date", dateFrom)
          .lte("invoice_date", dateTo),
        instQ,
      ]);
      if (expRes.error) throw expRes.error;
      if (purRes.error) throw purRes.error;
      if (instRes.error) throw instRes.error;

      const expensesVat =
        (expRes.data ?? []).reduce((s: number, r: any) => s + Number(r.vat_amount || 0), 0);
      const purchasesVat =
        (purRes.data ?? []).reduce((s: number, r: any) => s + Number(r.tax_amount || 0), 0);
      const installmentsVat = sumInstallmentVat((instRes.data ?? []) as any[]);
      const installmentBreakdown = breakdownInstallmentVat((instRes.data ?? []) as any[]);
      const postedVatByBatch = new Map<string, number>();
      for (const l of lines) {
        if (l.is_voided || !l.batch_id) continue;
        postedVatByBatch.set(
          l.batch_id,
          (postedVatByBatch.get(l.batch_id) ?? 0) + Number(l.debit || 0) - Number(l.credit || 0),
        );
      }
      const plansById = new Map(
        ((instRes.data ?? []) as any[]).map((p: any) => [String(p.id), p]),
      );
      const rowsWithGap = installmentBreakdown.rows.map((r) => {
        const p = plansById.get(r.id);
        const postedVat = p?.batch_id
          ? Math.round((postedVatByBatch.get(p.batch_id) ?? 0) * 100) / 100
          : null;
        const gap =
          postedVat === null ? null : Math.round(((r.excluded ? 0 : r.totalVat) - postedVat) * 100) / 100;
        return { ...r, postedVat, gap, hasGap: gap !== null && Math.abs(gap) > 0.02 };
      });

      return {
        ...reconcileVatRecoverable({
          lines,
          batches,
          expensesVat,
          purchasesVat,
          installmentsVat,
        }),
        installmentBreakdown: { ...installmentBreakdown, rows: rowsWithGap },
      };
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2 pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" />
          VAT Recoverable Reconciliation
        </CardTitle>
        {!isLoading && data && (
          <Badge
            variant="outline"
            className="text-xs font-normal gap-1"
          >
            {data.matched ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Ledger matches source
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3 text-destructive" /> Gap{" "}
                {formatCurrency(Math.abs(data.difference))}
              </>
            )}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !data ? (
          <div className="h-24 skeleton-shimmer rounded" />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <Figure label="Posted to ledger (1180)" value={formatCurrency(data.ledgerTotal)} />
              <Figure label="Expenses VAT" value={formatCurrency(data.expensesVat)} />
              <Figure label="Purchase invoices VAT" value={formatCurrency(data.purchasesVat)} />
              <Figure
                label="Installment purchases VAT"
                value={formatCurrency(data.installmentsVat)}
              />
              <Figure
                label="Difference"
                value={formatCurrency(data.difference)}
                tone={data.matched ? "ok" : "bad"}
              />
            </div>

            {!data.matched && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Input VAT does not tie to the ledger</AlertTitle>
                <AlertDescription className="text-xs">
                  Source documents record {formatCurrency(data.sourceTotal)} of recoverable VAT but{" "}
                  {formatCurrency(data.ledgerTotal)} was posted. Check for expenses posted without
                  their VAT split leg, voided legs, or VAT booked to a non-1180 account.
                </AlertDescription>
              </Alert>
            )}

            {data.unbatchedVat !== 0 && (
              <p className="text-[11px] text-muted-foreground">
                {formatCurrency(data.unbatchedVat)} of VAT sits on lines with no journal batch.
              </p>
            )}

            {data.installmentBreakdown.rows.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs hover:bg-muted/50">
                  <span className="flex items-center gap-2">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    Installment VAT components ({data.installmentBreakdown.rows.length} plan
                    {data.installmentBreakdown.rows.length === 1 ? "" : "s"})
                  </span>
                  <span className="text-muted-foreground">
                    Goods {formatCurrency(data.installmentBreakdown.goodsVat)} · Finance{" "}
                    {formatCurrency(data.installmentBreakdown.financeVat)}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 rounded-md border p-2">
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      These plans post input VAT straight to 1180 without an expense or purchase
                      invoice, so they explain gaps between the ledger and source documents. Where a
                      plan's components do not match what was posted, apply the suggested
                      reclassification.
                    </p>
                    <ScrollArea className="max-h-64">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr className="border-b">
                            <th className="py-1.5 text-left font-normal">Plan</th>
                            <th className="py-1.5 text-left font-normal">Date</th>
                            <th className="py-1.5 text-right font-normal">Goods VAT</th>
                            <th className="py-1.5 text-right font-normal">Finance VAT</th>
                            <th className="py-1.5 text-right font-normal">Total</th>
                            <th className="py-1.5 text-right font-normal">Posted</th>
                            <th className="py-1.5 text-right font-normal">Gap</th>
                            <th className="py-1.5 text-right font-normal"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.installmentBreakdown.rows.map((r) => (
                            <tr
                              key={r.id}
                              className={`border-b last:border-0 ${r.excluded ? "opacity-60" : ""}`}
                            >
                              <td className="py-1.5">
                                {r.label}
                                {r.excluded && (
                                  <Badge variant="outline" className="ml-2 text-[10px]">
                                    cancelled — excluded
                                  </Badge>
                                )}
                              </td>
                              <td className="py-1.5">{r.purchaseDate || "—"}</td>
                              <td className="py-1.5 text-right tabular-nums">
                                {formatCurrency(r.goodsVat)}
                              </td>
                              <td className="py-1.5 text-right tabular-nums">
                                {formatCurrency(r.financeVat)}
                              </td>
                              <td className="py-1.5 text-right tabular-nums font-medium">
                                {formatCurrency(r.totalVat)}
                              </td>
                              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                                {r.postedVat === null ? "not posted" : formatCurrency(r.postedVat)}
                              </td>
                              <td
                                className={`py-1.5 text-right tabular-nums ${r.hasGap ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                              >
                                {r.gap === null ? "—" : formatCurrency(r.gap)}
                              </td>
                              <td className="py-1.5 text-right">
                                {r.hasGap && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 gap-1 px-2 text-[11px]"
                                    onClick={() => setCorrectionPlanId(r.id)}
                                  >
                                    <Wand2 className="h-3 w-3" />
                                    Suggest fix
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t">
                            <td className="py-1.5 font-medium" colSpan={2}>
                              Counted as source VAT
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {formatCurrency(data.installmentBreakdown.goodsVat)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {formatCurrency(data.installmentBreakdown.financeVat)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums font-semibold">
                              {formatCurrency(data.installmentBreakdown.totalVat)}
                            </td>
                            <td colSpan={3} />
                          </tr>
                        </tfoot>
                      </table>
                    </ScrollArea>
                    {data.installmentBreakdown.excludedVat !== 0 && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {formatCurrency(data.installmentBreakdown.excludedVat)} sits on cancelled
                        plans and is excluded — if the ledger still shows it, the reversal legs are
                        missing.
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-2">
                By journal batch ({data.batches.length})
              </p>
              {data.batches.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No Input VAT legs posted in this period.
                </p>
              ) : (
                <ScrollArea className="max-h-64">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left font-normal py-1.5">Batch</th>
                        <th className="text-left font-normal py-1.5">Type</th>
                        <th className="text-left font-normal py-1.5">Date</th>
                        <th className="text-right font-normal py-1.5">Legs</th>
                        <th className="text-right font-normal py-1.5">VAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.batches.map((b) => (
                        <tr key={b.batchId} className="border-b last:border-0">
                          <td className="py-1.5 font-mono">{b.reference}</td>
                          <td className="py-1.5 capitalize">{b.journalType}</td>
                          <td className="py-1.5">{b.date || "—"}</td>
                          <td className="py-1.5 text-right tabular-nums">{b.lines}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {formatCurrency(b.vat)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </div>
          </>
        )}
      </CardContent>
      <InstallmentVatCorrectionDialog
        planId={correctionPlanId}
        open={!!correctionPlanId}
        onOpenChange={(v) => !v && setCorrectionPlanId(null)}
        fmt={formatCurrency}
        canApply={!!isOwner || !!isAccountant}
      />
    </Card>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "bad";
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className="text-lg font-semibold"
        style={
          tone === "ok"
            ? { color: "hsl(var(--success))" }
            : tone === "bad"
              ? { color: "hsl(var(--destructive))" }
              : undefined
        }
      >
        {value}
      </p>
    </div>
  );
}

export default VatRecoverableReconciliationPanel;
