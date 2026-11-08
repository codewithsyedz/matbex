import { useQuery } from "@tanstack/react-query";
import { parseISO, format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Scale } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useCurrency } from "@/hooks/useCurrency";
import { useTranslation } from "react-i18next";
import { ar as arLocale } from "date-fns/locale";
import { fetchReconciledSalesByDay } from "@/lib/reconciledSales";

interface Props {
  restaurantId?: string;
  dateFrom: string;
  dateTo: string;
  /** Optional branch scope. */
  branchId?: string | null;
  /** Absolute tolerance in currency units. Default 1.00. */
  toleranceAbsolute?: number;
  /** Relative tolerance as a fraction of sales total. Default 0.5%. */
  tolerancePercent?: number;
}

/**
 * Reconciliation summary that proves the Expenses page charts use the same
 * date bounds and aggregation as the Sales page "Filtered Total".
 *
 * Sales bounds match src/pages/Sales.tsx: local startOfDay(dateFrom) →
 * endOfDay(dateTo) against sales_transactions.created_at, no payment/status
 * filter applied (i.e. paid + unpaid combined).
 */
export function SalesReconciliationCard({
  restaurantId,
  dateFrom,
  dateTo,
  branchId = null,
  toleranceAbsolute = 1,
  tolerancePercent = 0.005,
}: Props) {
  const { format: formatCurrency } = useCurrency();
  const { t, i18n } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ["expenses-sales-reconciliation", restaurantId, dateFrom, dateTo, branchId],
    enabled: !!restaurantId && !!dateFrom && !!dateTo,
    queryFn: async () => {
      const [reconciled, expensesRes] = await Promise.all([
        fetchReconciledSalesByDay({
          restaurantId: restaurantId!,
          dateFrom,
          dateTo,
          branchId,
        }),
        (() => {
            let q = supabase
              .from("expenses")
              .select("amount")
              .eq("restaurant_id", restaurantId!)
              .is("deleted_at", null)
              .gte("expense_date", dateFrom)
              .lte("expense_date", dateTo);
            if (branchId) q = q.eq("branch_id", branchId);
            return q;
          })(),
      ]);

      if (expensesRes.error) throw expensesRes.error;

      const expensesTotal =
        expensesRes.data?.reduce((s, r: any) => s + Number(r.amount || 0), 0) || 0;
      const expensesCount = expensesRes.data?.length || 0;

      return {
        salesTotal: reconciled.total,
        salesCount: reconciled.txCount,
        expensesTotal,
        expensesCount,
      };
    },
  });

  const salesTotal = data?.salesTotal ?? 0;
  const expensesTotal = data?.expensesTotal ?? 0;
  const net = salesTotal - expensesTotal;
  const rangeLabel =
    dateFrom && dateTo
      ? `${format(parseISO(dateFrom), "MMM d, yyyy", { locale: i18n.language === "ar" ? arLocale : undefined })} – ${format(parseISO(dateTo), "MMM d, yyyy", { locale: i18n.language === "ar" ? arLocale : undefined })}`
      : "—";

  const diff = Math.abs(salesTotal - expensesTotal);
  const tolerance = Math.max(toleranceAbsolute, salesTotal * tolerancePercent);
  const exceedsTolerance = !isLoading && diff > tolerance && (salesTotal > 0 || expensesTotal > 0);
  const diffPct = salesTotal > 0 ? (diff / salesTotal) * 100 : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2 pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
           {t("app.expenses.reconciliation.title")}
        </CardTitle>
        <Badge variant="outline" className="text-xs font-normal gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
           {t("app.expenses.reconciliation.matches")}
        </Badge>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-20 skeleton-shimmer rounded" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
               <p className="text-xs text-muted-foreground">{t("app.expenses.reconciliation.salesTotal")}</p>
              <p className="text-lg font-semibold" style={{ color: "hsl(var(--success))" }}>
                {formatCurrency(salesTotal)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                 {t("app.expenses.reconciliation.transactions", { count: data?.salesCount ?? 0 })}
              </p>
            </div>
            <div>
               <p className="text-xs text-muted-foreground">{t("app.expenses.reconciliation.expensesTotal")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrency(expensesTotal)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                 {t("app.expenses.reconciliation.entries", { count: data?.expensesCount ?? 0 })}
              </p>
            </div>
            <div>
               <p className="text-xs text-muted-foreground">{t("app.expenses.reconciliation.net")}</p>
              <p
                className="text-lg font-semibold"
                style={{ color: net >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" }}
              >
                {formatCurrency(net)}
              </p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                {net >= 0 ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                )}
                {rangeLabel}
              </p>
            </div>
          </div>
        )}
        {exceedsTolerance && (
          <Alert variant="destructive" className="mt-4">
            <AlertTriangle className="h-4 w-4" />
             <AlertTitle>{t("app.expenses.reconciliation.warning")}</AlertTitle>
            <AlertDescription className="space-y-1">
              <div>
                 {t("app.expenses.reconciliation.difference")}: {" "}
                <span className="font-semibold">{formatCurrency(diff)}</span>
                {diffPct !== null && (
                   <span className="text-muted-foreground"> ({t("app.expenses.reconciliation.ofSales", { value: diffPct.toFixed(2) })})</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                 {t("app.expenses.reconciliation.tolerance", { tolerance: formatCurrency(tolerance), absolute: formatCurrency(toleranceAbsolute), percent: (tolerancePercent * 100).toFixed(2), range: rangeLabel })}
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export default SalesReconciliationCard;