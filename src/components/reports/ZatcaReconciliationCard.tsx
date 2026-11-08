import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, FileCheck2, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";

export interface ZatcaReconGroup {
  branch_id: string;
  branch_name: string;
  currency_code: string;
  ledger_revenue: number;
  ledger_expenses: number;
  sales_invoice_count: number;
  sales_filed_count: number;
  sales_filed_net: number;
  sales_filed_vat: number;
  sales_unfiled_net: number;
  credit_notes_net: number;
  credit_notes_vat: number;
  expense_count: number;
  expense_gross: number;
  expense_vat_inside: number;
  expense_vat_split: number;
  expense_matched_count: number;
  expense_matched_amount: number;
  expense_unmatched_count: number;
  expense_unmatched_amount: number;
  purchase_invoice_count: number;
  purchase_invoice_net: number;
  purchase_invoice_vat: number;
}

interface UnmatchedExpense {
  id: string;
  branch_name: string;
  currency_code: string;
  expense_date: string;
  description: string;
  supplier_name: string | null;
  amount: number;
  vat_amount: number;
}

/** Expenses as they should appear on the VAT return: ledger expenses minus VAT still sitting inside them. */
export const expensesNetOfVat = (g: Pick<ZatcaReconGroup, "ledger_expenses" | "expense_vat_inside">) =>
  Number(g.ledger_expenses) - Number(g.expense_vat_inside);

/** Revenue per ZATCA filings: filed net sales less filed credit notes. */
export const zatcaNetSales = (g: Pick<ZatcaReconGroup, "sales_filed_net" | "credit_notes_net">) =>
  Number(g.sales_filed_net) - Number(g.credit_notes_net);

export function useZatcaReconciliation(fromDate: string, toDate: string, branchId: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  return useQuery({
    queryKey: ["zatca-pl-reconciliation", tenantId, fromDate, toDate, branchId],
    enabled: Boolean(tenantId && fromDate && toDate),
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_zatca_pl_reconciliation" as never, {
        p_tenant_id: tenantId, p_from_date: fromDate, p_to_date: toDate, p_branch_id: branchId,
      } as never);
      if (error) throw error;
      const result = (data ?? {}) as { groups?: ZatcaReconGroup[]; unmatched_expenses?: UnmatchedExpense[] };
      return { groups: result.groups ?? [], unmatched: result.unmatched_expenses ?? [] };
    },
  });
}

export function ZatcaReconciliationCard({ fromDate, toDate, branchId }: { fromDate: string; toDate: string; branchId: string | null }) {
  const { i18n } = useTranslation();
  const ar = i18n.language?.startsWith("ar");
  const L = (en: string, arText: string) => (ar ? arText : en);
  const { format: money } = useCurrency();
  const fmt = (v: number, c: string) => money(Number(v), { showCode: true, fromCurrency: c });
  const { data, isLoading, error } = useZatcaReconciliation(fromDate, toDate, branchId);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const groups = data?.groups ?? [];
  const totals = useMemo(() => ({
    unmatched: groups.reduce((s, g) => s + Number(g.expense_unmatched_count), 0),
    unfiled: groups.reduce((s, g) => s + (Number(g.sales_invoice_count) - Number(g.sales_filed_count)), 0),
  }), [groups]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b py-4">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <FileCheck2 className="h-4 w-4 text-primary" />
          {L("ZATCA reconciliation", "مطابقة الزكاة والضريبة (ZATCA)")}
          {!isLoading && !error && (totals.unmatched > 0 || totals.unfiled > 0
            ? <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive"><TriangleAlert className="h-3 w-3" />{L(`${totals.unmatched} expenses without invoice · ${totals.unfiled} sales not filed`, `${totals.unmatched} مصروف بلا فاتورة · ${totals.unfiled} مبيعات غير مُبلغ عنها`)}</Badge>
            : <Badge variant="outline" className="gap-1 text-primary"><CheckCircle2 className="h-3 w-3" />{L("Matches filings", "مطابق للإقرارات")}</Badge>)}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{L(
          "Books vs ZATCA: sales e-invoices cleared/reported and supplier tax invoices. Expenses without an invoice are flagged but stay in totals.",
          "الدفاتر مقابل ZATCA: الفواتير الإلكترونية المعتمدة وفواتير الموردين الضريبية. المصروفات بلا فاتورة مُعلَّمة لكنها تبقى ضمن الإجماليات.")}</p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-32 w-full" /></div>
          : error ? <p className="p-4 text-sm text-destructive">{L("Could not load the ZATCA reconciliation.", "تعذر تحميل مطابقة ZATCA.")}</p>
          : groups.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{L("No activity in this period.", "لا توجد حركة في هذه الفترة.")}</p>
          : (
            <div className="overflow-x-auto">
              <Table className="min-w-[860px]">
                <TableHeader><TableRow>
                  <TableHead>{L("Branch", "الفرع")}</TableHead>
                  <TableHead>{L("Line", "البند")}</TableHead>
                  <TableHead className="text-end">{L("Books", "الدفاتر")}</TableHead>
                  <TableHead className="text-end">{L("ZATCA", "ZATCA")}</TableHead>
                  <TableHead className="text-end">{L("Difference", "الفرق")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {groups.map((g) => {
                    const c = g.currency_code;
                    const netExp = expensesNetOfVat(g);
                    const zSales = zatcaNetSales(g);
                    const salesDiff = Number(g.ledger_revenue) - zSales;
                    const expDiff = netExp - Number(g.purchase_invoice_net);
                    const vatDiff = Number(g.expense_vat_inside) + Number(g.expense_vat_split) - Number(g.purchase_invoice_vat);
                    const row = (label: string, books: number | null, zatca: number | null, diff: number | null, note?: string) => (
                      <TableRow key={label}>
                        <TableCell className="text-xs text-muted-foreground">{g.branch_name} <Badge variant="outline" className="ms-1 text-[10px]">{c}</Badge></TableCell>
                        <TableCell><span className="text-sm">{label}</span>{note && <span className="block text-[11px] text-muted-foreground">{note}</span>}</TableCell>
                        <TableCell className="text-end tabular-nums">{books === null ? "—" : fmt(books, c)}</TableCell>
                        <TableCell className="text-end tabular-nums">{zatca === null ? "—" : fmt(zatca, c)}</TableCell>
                        <TableCell className={`text-end tabular-nums ${diff !== null && Math.abs(diff) >= 0.01 ? "text-destructive" : "text-muted-foreground"}`}>{diff === null ? "—" : fmt(diff, c)}</TableCell>
                      </TableRow>
                    );
                    return [
                      row(L("Sales (net of VAT)", "المبيعات (صافي الضريبة)"), Number(g.ledger_revenue), zSales, salesDiff,
                        L(`${g.sales_filed_count}/${g.sales_invoice_count} e-invoices filed · credit notes ${fmt(g.credit_notes_net, c)}`, `${g.sales_filed_count}/${g.sales_invoice_count} فاتورة مُبلغ عنها · إشعارات دائنة ${fmt(g.credit_notes_net, c)}`)),
                      row(L("Output VAT", "ضريبة المخرجات"), null, Number(g.sales_filed_vat) - Number(g.credit_notes_vat), null),
                      row(L("Expenses in books", "المصروفات في الدفاتر"), Number(g.ledger_expenses), null, null),
                      row(L("Less: VAT still inside expenses", "ناقص: ضريبة ما زالت داخل المصروفات"), -Number(g.expense_vat_inside), null, null),
                      row(L("Expenses net of VAT", "المصروفات صافي الضريبة"), netExp, Number(g.purchase_invoice_net), expDiff,
                        L(`${g.purchase_invoice_count} supplier tax invoices · ${g.expense_unmatched_count} expenses (${fmt(g.expense_unmatched_amount, c)}) without invoice`, `${g.purchase_invoice_count} فاتورة مورد · ${g.expense_unmatched_count} مصروف (${fmt(g.expense_unmatched_amount, c)}) بلا فاتورة`)),
                      row(L("Input VAT", "ضريبة المدخلات"), Number(g.expense_vat_inside) + Number(g.expense_vat_split), Number(g.purchase_invoice_vat), vatDiff),
                    ];
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        {(data?.unmatched.length ?? 0) > 0 && (
          <div className="border-t p-3">
            <Button variant="ghost" size="sm" onClick={() => setShowUnmatched((v) => !v)}>
              <TriangleAlert className="me-1.5 h-3.5 w-3.5 text-destructive" />
              {showUnmatched ? L("Hide flagged expenses", "إخفاء المصروفات المُعلَّمة") : L(`Show ${data!.unmatched.length} flagged expenses (largest first)`, `عرض ${data!.unmatched.length} مصروف مُعلَّم (الأكبر أولاً)`)}
            </Button>
            {showUnmatched && (
              <div className="mt-2 max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{L("Date", "التاريخ")}</TableHead><TableHead>{L("Branch", "الفرع")}</TableHead>
                    <TableHead>{L("Description", "الوصف")}</TableHead><TableHead>{L("Supplier", "المورد")}</TableHead>
                    <TableHead className="text-end">{L("VAT", "الضريبة")}</TableHead><TableHead className="text-end">{L("Amount", "المبلغ")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{data!.unmatched.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.expense_date}</TableCell>
                      <TableCell className="text-xs">{e.branch_name}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-sm">{e.description}</TableCell>
                      <TableCell className="text-xs">{e.supplier_name ?? "—"}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(e.vat_amount, e.currency_code)}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(e.amount, e.currency_code)}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
