import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  CircleDollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  Wallet,
  BookOpen,
  BookOpenCheck,
  ScrollText,
  FileText,
  ArrowUpRight,
  Lock,
  Scale,
  Download,
  Layers,
  Pin,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { CardTooltip } from "@/components/ui/CardTooltip";
import { RouteSeo } from "@/components/seo/RouteSeo";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useAuth } from "@/contexts/AuthContext";
import { useMonthlyPL } from "@/hooks/useProfitLoss";
import { useCurrency } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { useBranch } from "@/contexts/BranchContext";
import {
  BranchDateRangeFilter,
  resolvePreset,
  type DateRangePreset,
} from "@/components/filters/BranchDateRangeFilter";
import { usePersistedBranchDateFilter } from "@/hooks/usePersistedBranchDateFilter";
import { TrialBalanceWidget } from "@/components/finance/TrialBalanceWidget";
import { SupplierScopeSelector } from "@/components/filters/SupplierScopeSelector";
import { toast } from "sonner";

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  expense: "Operating Expenses",
};

const ACCOUNT_TYPE_ORDER = ["asset", "liability", "equity", "revenue", "cogs", "expense"];

export default function FinanceDashboard() {
  const { t } = useTranslation();
  const { tenant, restaurant, hasFeature, loading } = useAuth();
  const { format: fmt } = useCurrency();
  const { activeBranchId, pinnedBranchId, isAllBranches, setActiveBranchId } = useBranch();

  const {
    branchId: filterBranchId,
    setBranchId: setFilterBranchId,
    preset: datePreset,
    setPreset: setDatePreset,
    customRange,
    setCustomRange,
  } = usePersistedBranchDateFilter("finance", tenant?.id, {
    branchId: pinnedBranchId ?? activeBranchId ?? "all",
    preset: "this-month",
  });

  const range = datePreset === "custom" ? customRange : resolvePreset(datePreset);

  // Keep the page filter and the global branch context in one shared scope so
  // every chart on this page reacts to either control.
  const contextBranch = pinnedBranchId ?? (isAllBranches ? "all" : activeBranchId ?? "all");
  useEffect(() => {
    if (contextBranch && contextBranch !== filterBranchId) {
      setFilterBranchId(contextBranch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextBranch]);

  const handleBranchChange = (next: string) => {
    setFilterBranchId(next);
    setActiveBranchId(next === "all" ? "all" : next);
  };

  // Hooks expect either a concrete branch id, or null for "all branches"
  const branchKey = filterBranchId && filterBranchId !== "all" ? filterBranchId : null;

  // Anchor P&L to the start of the selected range (or today as fallback).
  const referenceDate = range?.from ?? new Date();
  const rangeFrom = range?.from ?? null;
  const rangeTo = range?.to ?? null;
  const periodLabel =
    rangeFrom && rangeTo
      ? `${format(rangeFrom, "MMM d, yyyy")} – ${format(rangeTo, "MMM d, yyyy")}`
      : format(new Date(), "MMMM yyyy");

  const [supplierScope, setSupplierScope] = useState<string>("all");
  const supplierKey = supplierScope !== "all" ? supplierScope : null;

  const { current: pl, isLoading: plLoading } = useMonthlyPL(referenceDate, branchKey, supplierKey);

  const exportPLCsv = () => {
    if (!pl) return;
    const lines: string[] = [];
    lines.push(`P&L,${tenant?.name ?? ""}`);
    lines.push(`Period,${periodLabel}`);
    lines.push(`Branch,${branchKey ? branchKey : "All branches"}`);
    lines.push(`Supplier scope,${supplierScope === "all" ? "All suppliers" : supplierScope === "none" ? "No supplier" : supplierScope}`);
    lines.push("");
    lines.push("Section,Item,Amount");
    lines.push(`Revenue,Gross Sales,${pl.revenue.grossSales.toFixed(2)}`);
    lines.push(`Revenue,Discounts,${pl.revenue.discounts.toFixed(2)}`);
    lines.push(`Revenue,Refunds,${pl.revenue.refunds.toFixed(2)}`);
    lines.push(`Revenue,Net Sales,${pl.revenue.netSales.toFixed(2)}`);
    lines.push(`COGS,Food Cost,${pl.cogs.foodCost.toFixed(2)}`);
    lines.push(`COGS,Beverage Cost,${pl.cogs.beverageCost.toFixed(2)}`);
    lines.push(`COGS,Total COGS,${pl.cogs.totalCOGS.toFixed(2)}`);
    lines.push(`Gross Profit,Gross Profit,${pl.grossProfit.toFixed(2)}`);
    lines.push(`Operating,Labor,${pl.operatingExpenses.laborCost.toFixed(2)}`);
    for (const o of pl.operatingExpenses.overhead) {
      lines.push(`Operating,Overhead - ${o.name.replace(/,/g, " ")},${o.amount.toFixed(2)}`);
    }
    lines.push(`Operating,Total Overhead,${pl.operatingExpenses.totalOverhead.toFixed(2)}`);
    lines.push(`Operating,Other Expenses,${pl.operatingExpenses.otherExpenses.toFixed(2)}`);
    lines.push(`Operating,Total Operating,${pl.operatingExpenses.totalOperating.toFixed(2)}`);
    lines.push(`Profit,Operating Profit,${pl.operatingProfit.toFixed(2)}`);
    lines.push(`Profit,Net Income,${pl.netIncome.toFixed(2)}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pnl_${branchKey ?? "all"}_${
      rangeFrom ? format(rangeFrom, "yyyy-MM-dd") : "x"
    }_${rangeTo ? format(rangeTo, "yyyy-MM-dd") : "x"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("P&L exported");
  };

  // Chart of accounts balances grouped by type
  const { data: coa, isLoading: coaLoading } = useQuery({
    queryKey: ["finance-dashboard-coa", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type, balance, is_active")
        .eq("tenant_id", tenant!.id)
        .eq("is_active", true)
        .order("account_code", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 2,
  });

  // When a specific branch is selected, chart_of_accounts.balance (tenant-wide)
  // is not valid — derive all-time balances from that branch's ledger lines.
  const { data: branchBalances, isLoading: branchBalancesLoading } = useQuery({
    queryKey: ["finance-dashboard-branch-balances", tenant?.id, branchKey],
    enabled: !!tenant?.id && !!branchKey,
    queryFn: async () => {
      const pageSize = 1000;
      let page = 0;
      const all: Array<{ account_id: string; debit: number | null; credit: number | null }> = [];
      while (true) {
        const { data, error } = await supabase
          .from("account_transactions")
          .select("account_id, debit, credit")
          .eq("tenant_id", tenant!.id)
          .eq("is_voided", false)
          .eq("branch_id", branchKey!)
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (error) throw error;
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        page += 1;
        if (page > 50) break;
      }
      return all;
    },
    staleTime: 1000 * 60 * 2,
  });

  const accountTypeTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    if (branchKey) {
      const typeById = new Map<string, string>();
      (coa ?? []).forEach((a) => typeById.set(a.id, a.account_type));
      (branchBalances ?? []).forEach((t) => {
        const type = typeById.get(t.account_id);
        if (!type) return;
        const normalDebit = type === "asset" || type === "expense" || type === "cogs";
        const d = Number(t.debit ?? 0);
        const c = Number(t.credit ?? 0);
        totals[type] = (totals[type] ?? 0) + (normalDebit ? d - c : c - d);
      });
      return totals;
    }
    (coa ?? []).forEach((a) => {
      totals[a.account_type] = (totals[a.account_type] ?? 0) + Number(a.balance ?? 0);
    });
    return totals;
  }, [coa, branchKey, branchBalances]);

  // Recent journal entries (last 10 non-voided account transactions)
  const { data: recentTx, isLoading: txLoading } = useQuery({
    queryKey: [
      "finance-dashboard-recent-tx",
      tenant?.id,
      branchKey,
      rangeFrom?.toISOString() ?? null,
      rangeTo?.toISOString() ?? null,
    ],
    enabled: !!tenant?.id && !!rangeFrom && !!rangeTo,
    queryFn: async () => {
      let q = supabase
        .from("account_transactions")
        .select("id, transaction_date, debit, credit, description, reference_type, account_id")
        .eq("tenant_id", tenant!.id)
        .eq("is_voided", false)
        .gte("transaction_date", format(rangeFrom!, "yyyy-MM-dd"))
        .lte("transaction_date", format(rangeTo!, "yyyy-MM-dd"))
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 2,
  });

  const coaLookup = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    (coa ?? []).forEach((a) =>
      map.set(a.id, { code: a.account_code, name: a.account_name })
    );
    return map;
  }, [coa]);

  // Recent expenses (paid + pending), top 10 by date
  const { data: recentExpenses, isLoading: expLoading } = useQuery({
    queryKey: [
      "finance-dashboard-expenses",
      restaurant?.id,
      filterBranchId,
      rangeFrom?.toISOString() ?? null,
      rangeTo?.toISOString() ?? null,
    ],
    enabled: !!restaurant?.id && !!rangeFrom && !!rangeTo,
    queryFn: async () => {
      let q = supabase
        .from("expenses")
        .select("id, amount, description, expense_date, status, payment_method, category_id, branch_id")
        .eq("restaurant_id", restaurant!.id)
        .is("deleted_at", null)
        .gte("expense_date", format(rangeFrom!, "yyyy-MM-dd"))
        .lte("expense_date", format(rangeTo!, "yyyy-MM-dd"))
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);
      if (filterBranchId && filterBranchId !== "all") {
        q = q.eq("branch_id", filterBranchId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 2,
  });

  if (!loading && !hasFeature("accounting")) {
    return (
      <>
        <LockedFeatureScreen
          featureName="Finance Dashboard"
          description="A read-only finance overview for accountants: P&L summary, ledger balances, recent journal entries, and expenses."
          featureKey="accounting"
        />
      </>
    );
  }

  return (
    <>
      <RouteSeo
        title="Finance Dashboard | Matbex"
        description="Live P&L, ledger balances, recent journal entries, and expenses for your restaurant."
        path="/dashboard"
        noindex
      />
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
              <CircleDollarSign className="h-7 w-7 text-primary" />
              {t("finance.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              <Lock className="h-3.5 w-3.5" />
              {t("finance.subtitle")} · {periodLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <BranchDateRangeFilter
            branchId={filterBranchId}
            onBranchChange={handleBranchChange}
            preset={datePreset}
            onPresetChange={setDatePreset}
            dateRange={customRange}
            onDateRangeChange={setCustomRange}
          />
          <SupplierScopeSelector
            value={supplierScope}
            onChange={setSupplierScope}
            className="h-9 w-[170px]"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={exportPLCsv}
            disabled={plLoading || !pl}
          >
            <Download className="h-3.5 w-3.5" /> Export P&L CSV
          </Button>
          </div>
        </header>

        {/* Pinned shortcut */}
        <div className="flex">
          <Button
            asChild
            variant="outline"
            className="gap-2 h-auto py-2.5 px-4 border-primary/30 bg-primary/5 hover:bg-primary/10"
          >
            <Link to="/reports/ledger-mapping">
              <Pin className="h-4 w-4 text-primary fill-primary" />
              <span className="font-medium">Ledger Mapping</span>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label={t("finance.kpi.netSales")}
            value={pl?.revenue.netSales}
            loading={plLoading}
            icon={Receipt}
            tone="primary"
            formatter={fmt}
            tooltip={
              <>
                Revenue from recorded sales for the selected branch and date range,
                net of returns and discounts.
              </>
            }
          />
          <KpiCard
            label={t("finance.kpi.totalCogs")}
            value={pl?.cogs.totalCOGS}
            loading={plLoading}
            icon={TrendingDown}
            tone="warning"
            formatter={fmt}
            tooltip={
              <>
                Cost of goods sold from branch-filtered inventory consumption,
                purchases, recipes, and waste for the selected period.
              </>
            }
          />
          <KpiCard
            label={t("finance.kpi.grossProfit")}
            value={pl?.grossProfit}
            subValue={pl ? t("finance.kpi.margin", { value: pl.grossMargin.toFixed(1) }) : undefined}
            loading={plLoading}
            icon={TrendingUp}
            tone="emerald"
            formatter={fmt}
            tooltip={
              <>
                Net Sales minus Total COGS. Margin is calculated as a percentage
                of Net Sales for the selected branch and period.
              </>
            }
          />
          <KpiCard
            label={t("finance.kpi.netIncome")}
            value={pl?.netIncome}
            subValue={pl ? t("finance.kpi.margin", { value: pl.netMargin.toFixed(1) }) : undefined}
            loading={plLoading}
            icon={CircleDollarSign}
            tone={pl && pl.netIncome >= 0 ? "emerald" : "destructive"}
            formatter={fmt}
            tooltip={
              <>
                Gross Profit minus operating expenses, overheads, payroll, and
                other costs for the selected branch and date range.
              </>
            }
          />
        </div>

        {/* Account Balances + Quick Links */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                {t("finance.ledgerBalances")}
              </CardTitle>
              <CardDescription>
                {branchKey
                  ? "All-time balances derived from this branch's ledger entries"
                  : "Current balances from the chart of accounts (all-time, all branches)"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {coaLoading || (branchKey && branchBalancesLoading) ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 rounded-lg" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {ACCOUNT_TYPE_ORDER.map((type) => (
                    <div
                      key={type}
                      className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-1"
                    >
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">
                        {ACCOUNT_TYPE_LABEL[type]}
                      </span>
                      <span className="text-lg font-semibold tabular-nums">
                        {fmt(accountTypeTotals[type] ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Jump to Reports</CardTitle>
              <CardDescription>Full read-only access to finance modules</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <QuickLink to="/accounting" icon={BookOpen} label="Chart of Accounts & Ledger" />
              <QuickLink to="/reports" icon={FileText} label="Profit & Loss Reports" />
              <QuickLink to="/reports/trial-balance" icon={Scale} label="Trial Balance" />
              <QuickLink to="/reports/balance-sheet" icon={BookOpenCheck} label={t("app.balanceSheet.title")} />
              <QuickLink to="/reports/ap-aging" icon={Layers} label="Accounts Payable Aging" />
              <QuickLink to="/reports/ap-audit-trail" icon={Layers} label="AP Audit Trail" />
              <QuickLink to="/reports/reversal-audit" icon={Layers} label="Reversal & Reopening Audit" />
              <QuickLink to="/reports/day-end-status" icon={Layers} label="Day-End Status Matrix" />
              <QuickLink to="/reports/ledger-mapping" icon={Layers} label="Expense → Ledger Mapping" />
              <QuickLink to="/reports/depreciation" icon={Layers} label="Asset Depreciation" />
              <QuickLink to="/reports/card-sales-by-branch" icon={Layers} label="Card Sales by Branch" />
              <QuickLink to="/reports/vat-return" icon={ScrollText} label="VAT Return" />
              <QuickLink to="/expenses" icon={Wallet} label="Expenses" />
            </CardContent>
          </Card>
        </div>

        {/* Trial Balance summary for the selected period */}
        <TrialBalanceWidget from={rangeFrom} to={rangeTo} branchId={branchKey} />

        {/* Recent Journal Entries */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <ScrollText className="h-4 w-4" />
              Recent Journal Entries
            </CardTitle>
            <CardDescription>
              Last 10 posted ledger entries for {periodLabel}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[420px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : (recentTx ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No ledger entries in this period
                      </TableCell>
                    </TableRow>
                  ) : (
                    (recentTx ?? []).map((tx) => {
                      const acct = coaLookup.get(tx.account_id);
                      return (
                        <TableRow key={tx.id}>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {format(new Date(tx.transaction_date), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell>
                            {acct ? (
                              <div className="flex flex-col">
                                <span className="font-medium text-sm">{acct.name}</span>
                                <span className="text-xs text-muted-foreground">{acct.code}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            <span className="text-sm text-muted-foreground line-clamp-1">
                              {tx.description || tx.reference_type || "-"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(tx.debit) > 0 ? fmt(Number(tx.debit)) : "-"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(tx.credit) > 0 ? fmt(Number(tx.credit)) : "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Recent Expenses */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Recent Expenses
            </CardTitle>
            <CardDescription>
              Last 10 expenses for {periodLabel}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[420px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : (recentExpenses ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No expenses in this period
                      </TableCell>
                    </TableRow>
                  ) : (
                    (recentExpenses ?? []).map((exp) => (
                      <TableRow key={exp.id}>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {format(new Date(exp.expense_date), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          <span className="text-sm line-clamp-1">{exp.description || "-"}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm capitalize">
                          {exp.payment_method || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              exp.status === "paid"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                            }
                          >
                            {exp.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {fmt(Number(exp.amount))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function KpiCard({
  label,
  value,
  subValue,
  loading,
  icon: Icon,
  tone,
  formatter,
  tooltip,
}: {
  label: string;
  value?: number;
  subValue?: string;
  loading: boolean;
  icon: React.ComponentType<{ className?: string }>;
  tone: "primary" | "emerald" | "warning" | "destructive";
  formatter: (n: number) => string;
  tooltip?: React.ReactNode;
}) {
  const toneClass: Record<typeof tone, string> = {
    primary: "bg-primary/10 text-primary",
    emerald: "bg-emerald-500/10 text-emerald-600",
    warning: "bg-amber-500/10 text-amber-600",
    destructive: "bg-destructive/10 text-destructive",
  };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center">{label}{tooltip && <CardTooltip label={label}>{tooltip}</CardTooltip>}</p>
            {loading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">
                {formatter(value ?? 0)}
              </p>
            )}
            {subValue && !loading && (
              <p className="text-xs text-muted-foreground">{subValue}</p>
            )}
          </div>
          <div className={`rounded-lg p-2 ${toneClass[tone]}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Button asChild variant="outline" className="justify-between h-auto py-3">
      <Link to={to}>
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <span className="text-sm font-medium">{label}</span>
        </span>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </Button>
  );
}