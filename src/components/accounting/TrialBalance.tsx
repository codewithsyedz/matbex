import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/reports/DateRangePicker";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/contexts/AuthContext";
import { useFiscalSettings, getFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { Scale, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";

/**
 * Trial Balance Report
 * Lists every CoA account with: Opening Balance, Current Period Debit,
 * Current Period Credit, Closing Balance. Totals at the bottom must balance
 * (Σ Debit == Σ Credit).
 *
 * Convention: balance = Σdebit - Σcredit (signed).
 * Credit-natured accounts (liability/equity/revenue) show as negative.
 */
export function TrialBalance() {
  const { profile, restaurant } = useAuth();
  const { accounts, isLoading: loadingAccounts, isVisibleForBranch } = useChartOfAccounts();
  const { format: formatCurrency } = useCurrency();
  const { monthStartDay } = useFiscalSettings();
  const { activeBranchId, activeBranch, isAllBranches, branches } = useBranch();
  const branchScopeLabel = isAllBranches || !activeBranchId
    ? "All branches"
    : activeBranch?.name ?? "Branch";

  const fiscalRange = useMemo(
    () => getFiscalMonthRange(new Date(), monthStartDay),
    [monthStartDay]
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: fiscalRange.start,
    to: fiscalRange.end,
  });

  const fromIso = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
  const toIso = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : fromIso;

  // Fetch every non-voided transaction up to the period end, then bucket
  // into "opening" (before fromIso) vs "period" (within range).
  const { data: rows = [], isLoading: loadingTx } = useQuery({
    queryKey: ["trial-balance-tx", profile?.tenant_id, fromIso, toIso],
    queryFn: async () => {
      if (!profile?.tenant_id || !fromIso || !toIso) return [];
      const pageSize = 1000;
      let from = 0;
      const all: any[] = [];
      // paginate to avoid PostgREST 1000-row cap
      while (true) {
        const { data, error } = await supabase
          .from("account_transactions")
          .select("account_id, transaction_date, debit, credit, is_voided")
          .eq("tenant_id", profile.tenant_id)
          .eq("is_voided", false)
          .lte("transaction_date", toIso)
          .order("transaction_date", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    enabled: !!profile?.tenant_id && !!fromIso && !!toIso,
  });

  // Aggregate per account
  const trialRows = useMemo(() => {
    const agg: Record<string, { opening: number; debit: number; credit: number }> = {};
    for (const t of rows as any[]) {
      const d = Number(t.debit) || 0;
      const c = Number(t.credit) || 0;
      const key = t.account_id as string;
      if (!agg[key]) agg[key] = { opening: 0, debit: 0, credit: 0 };
      if (fromIso && t.transaction_date < fromIso) {
        agg[key].opening += d - c;
      } else {
        agg[key].debit += d;
        agg[key].credit += c;
      }
    }
    return accounts
      .filter((a) => isVisibleForBranch(a.id, activeBranchId ?? null))
      .slice()
      .sort((a, b) => a.account_code.localeCompare(b.account_code))
      .map((a) => {
        const x = agg[a.id] || { opening: 0, debit: 0, credit: 0 };
        const closing = x.opening + x.debit - x.credit;
        return {
          id: a.id,
          code: a.account_code,
          name: a.account_name,
          type: a.account_type,
          opening: x.opening,
          debit: x.debit,
          credit: x.credit,
          closing,
        };
      });
  }, [accounts, rows, fromIso, activeBranchId, isVisibleForBranch]);

  const totals = useMemo(() => {
    return trialRows.reduce(
      (acc, r) => {
        acc.opening += r.opening;
        acc.debit += r.debit;
        acc.credit += r.credit;
        acc.closing += r.closing;
        return acc;
      },
      { opening: 0, debit: 0, credit: 0, closing: 0 }
    );
  }, [trialRows]);

  const isBalanced = Math.abs(totals.debit - totals.credit) < 0.01;
  const isLoading = loadingAccounts || loadingTx;

  const fmtSigned = (n: number) => {
    if (Math.abs(n) < 0.005) return "-";
    return n < 0 ? `(${formatCurrency(Math.abs(n))})` : formatCurrency(n);
  };
  const fmtPos = (n: number) => (Math.abs(n) < 0.005 ? "-" : formatCurrency(n));

  const exportCsv = () => {
    const meta = [
      `Branch,${branchScopeLabel}`,
      `Period,${fromIso ?? ""} to ${toIso ?? ""}`,
      "",
    ];
    const header = [
      "Account Code",
      "Account Name",
      "Opening Balance",
      "Current Period Debit",
      "Current Period Credit",
      "Closing Balance",
    ];
    const lines = [...meta, header.join(",")];
    for (const r of trialRows) {
      lines.push(
        [r.code, `"${r.name.replace(/"/g, '""')}"`, r.opening.toFixed(2), r.debit.toFixed(2), r.credit.toFixed(2), r.closing.toFixed(2)].join(",")
      );
    }
    lines.push(["TOTAL", "", totals.opening.toFixed(2), totals.debit.toFixed(2), totals.credit.toFixed(2), totals.closing.toFixed(2)].join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeBranch = branchScopeLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.href = url;
    a.download = `trial-balance_${safeBranch}_${fromIso}_${toIso}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Scale className="h-5 w-5" />
                Trial Balance
              </CardTitle>
              <CardDescription>
                {(restaurant as any)?.name ? <span className="font-medium">{(restaurant as any).name} — </span> : null}
                <span className="font-medium">{branchScopeLabel} — </span>
                Period{" "}
                <span className="font-mono">
                  {dateRange?.from ? format(dateRange.from, "dd-MMM-yy") : "—"}
                </span>{" "}
                to{" "}
                <span className="font-mono">
                  {dateRange?.to ? format(dateRange.to, "dd-MMM-yy") : "—"}
                </span>
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={`mb-3 flex items-center gap-2 text-sm rounded-md px-3 py-2 border ${
              isBalanced
                ? "bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400"
                : "bg-destructive/5 border-destructive/20 text-destructive"
            }`}
          >
            {isBalanced ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {isBalanced
              ? `Balanced: total debits equal total credits (${formatCurrency(totals.debit)}).`
              : `Out of balance by ${formatCurrency(Math.abs(totals.debit - totals.credit))}. Review journal entries.`}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">Account Code</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Opening Balance</TableHead>
                    <TableHead className="text-right">Current Period Debit</TableHead>
                    <TableHead className="text-right">Current Period Credit</TableHead>
                    <TableHead className="text-right">Closing Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trialRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                        No accounts found
                      </TableCell>
                    </TableRow>
                  ) : (
                    trialRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.code}</TableCell>
                        <TableCell className="text-sm">{r.name}</TableCell>
                        <TableCell className="text-right font-mono">{fmtSigned(r.opening)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtPos(r.debit)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtPos(r.credit)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtSigned(r.closing)}</TableCell>
                      </TableRow>
                    ))
                  )}
                  <TableRow className="border-t-2 font-semibold bg-muted/40">
                    <TableCell />
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right font-mono">{fmtSigned(totals.opening)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtPos(totals.debit)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtPos(totals.credit)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtSigned(totals.closing)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}