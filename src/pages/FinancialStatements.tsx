import { ZatcaReconciliationCard } from "@/components/reports/ZatcaReconciliationCard";
import { useMemo, useState } from "react";
import { endOfDay, format, startOfMonth } from "date-fns";
import {
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  CircleDollarSign,
  PieChart,
  RefreshCw,
  Scale,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBalanceSheet } from "@/hooks/useBalanceSheet";
import { useCashFlow } from "@/hooks/useCashFlow";
import { useCurrency } from "@/hooks/useCurrency";
import { useProfitLossReport } from "@/hooks/useProfitLossReport";

type StatementTileProps = {
  title: string;
  description: string;
  href: string;
  icon: typeof Scale;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  isEmpty: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
};

function StatementTile({ title, description, href, icon: Icon, isLoading, isFetching, error, isEmpty, onRefresh, children }: StatementTileProps) {
  const { t } = useTranslation();
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <CardHeader className="border-b pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 shrink-0 text-primary" />{title}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onRefresh} disabled={isFetching} aria-label={t("app.financialStatements.refresh", { report: title })}>
                  <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("app.financialStatements.refresh", { report: title })}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-0">
        {isLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
        ) : error ? (
          <Alert variant="destructive" className="m-4"><TriangleAlert className="h-4 w-4" /><AlertTitle>{t("app.financialStatements.loadFailed")}</AlertTitle><AlertDescription>{t("app.financialStatements.tryAgain")}</AlertDescription></Alert>
        ) : isEmpty ? (
          <div className="flex min-h-48 items-center justify-center p-6 text-center text-sm text-muted-foreground">{t("app.financialStatements.noData")}</div>
        ) : children}
        <div className="mt-auto border-t p-3">
          <Button asChild variant="ghost" className="w-full justify-between">
            <Link to={href}>{t("app.financialStatements.openReport")}<ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" /></Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FinancialStatements() {
  const { t } = useTranslation();
  const { hasFeature, loading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { baseCurrency, displayCurrency, setDisplayCurrency, supportedCurrencies, convert, format: money, ratesLoading } = useCurrency();
  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfDay(new Date()), "yyyy-MM-dd"));
  const [branchValue, setBranchValue] = useState(pinnedBranchId ?? activeBranchId ?? "all");
  const selectedBranchId = branchValue === "all" ? null : branchValue;

  const balanceSheet = useBalanceSheet(toDate, selectedBranchId);
  const parseDayValue = (value: string) => {
    if (!value) return null;
    const parsed = new Date(`${value}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const cashFlow = useCashFlow(parseDayValue(fromDate), parseDayValue(toDate), selectedBranchId);
  const profitLoss = useProfitLossReport(fromDate, toDate, selectedBranchId);
  const formatAmount = (amount: number, currency: string) => money(convert(amount, currency), { showCode: true, fromCurrency: displayCurrency });

  const reportParams = useMemo(() => new URLSearchParams({
    ...(selectedBranchId ? { branch: selectedBranchId } : {}),
    from: fromDate,
    to: toDate,
  }).toString(), [fromDate, selectedBranchId, toDate]);

  if (!loading && !hasFeature("accounting")) return <LockedFeatureScreen featureName={t("app.financialStatements.title")} />;

  const tableHeader = (labels: string[]) => <TableHeader><TableRow>{labels.map((label, index) => <TableHead key={label} className={index === 0 ? undefined : "text-end"}>{label}</TableHead>)}</TableRow></TableHeader>;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase text-primary"><CircleDollarSign className="h-4 w-4" />{t("app.financialStatements.ledgerOverview")}</div>
          <h1 className="mt-2 font-display text-2xl font-semibold md:text-3xl">{t("app.financialStatements.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("app.financialStatements.subtitle")}</p>
        </div>
        <div className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 xl:grid-cols-4">
          <div><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="statements-from">{t("app.financialStatements.fromDate")}</label><Input id="statements-from" type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="statements-to">{t("app.financialStatements.toDate")}</label><Input id="statements-to" type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-medium text-muted-foreground">{t("app.financialStatements.branch")}</label><Select value={branchValue} onValueChange={setBranchValue} disabled={!canSwitchBranches}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{canSwitchBranches && <SelectItem value="all">{t("app.financialStatements.allBranches")}</SelectItem>}{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectContent></Select></div>
          <div><label className="mb-1 block text-xs font-medium text-muted-foreground">{t("app.financialStatements.currency")}</label><Select value={displayCurrency} onValueChange={setDisplayCurrency} disabled={ratesLoading}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{supportedCurrencies.map((currency) => <SelectItem key={currency.code} value={currency.code}>{currency.code}</SelectItem>)}</SelectContent></Select></div>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-3">
        <StatementTile title={t("app.balanceSheet.title")} description={t("app.financialStatements.balanceSheetDescription", { date: toDate })} href={`/reports/balance-sheet?${new URLSearchParams({ ...(selectedBranchId ? { branch: selectedBranchId } : {}), asOf: toDate }).toString()}`} icon={BookOpenCheck} isLoading={balanceSheet.isLoading} isFetching={balanceSheet.isFetching} error={balanceSheet.error} isEmpty={balanceSheet.groups.length === 0} onRefresh={() => void balanceSheet.refetch()}>
          <Table className="min-w-[460px]">{tableHeader([t("app.financialStatements.branchCurrency"), t("app.balanceSheet.sections.assets"), t("app.financialStatements.liabilitiesEquity")])}<TableBody>{balanceSheet.groups.map((group) => <TableRow key={group.key}><TableCell><span className="font-medium">{group.branchName}</span><Badge variant="outline" className="ms-2">{group.currencyCode}</Badge></TableCell><TableCell className="text-end font-medium">{formatAmount(group.assets, group.currencyCode)}</TableCell><TableCell className="text-end"><span className="block">{formatAmount(group.liabilities + group.equity, group.currencyCode)}</span><span className={`text-xs ${Math.abs(group.variance) < 0.01 ? "text-primary" : "text-destructive"}`}>{Math.abs(group.variance) < 0.01 ? t("app.financialStatements.balanced") : t("app.financialStatements.variance", { amount: formatAmount(group.variance, group.currencyCode) })}</span></TableCell></TableRow>)}</TableBody></Table>
        </StatementTile>

        <StatementTile title={t("app.cashFlow.title")} description={t("app.financialStatements.periodDescription", { from: fromDate, to: toDate })} href={`/reports/cash-flow?${reportParams}`} icon={Waves} isLoading={cashFlow.isLoading} isFetching={cashFlow.isFetching} error={cashFlow.error} isEmpty={cashFlow.groups.length === 0} onRefresh={() => void cashFlow.refetch()}>
          <Table className="min-w-[460px]">{tableHeader([t("app.financialStatements.branchCurrency"), t("app.cashFlow.kpis.operating"), t("app.cashFlow.kpis.netChange")])}<TableBody>{cashFlow.groups.map((group) => <TableRow key={group.key}><TableCell><span className="font-medium">{group.branchName}</span><Badge variant="outline" className="ms-2">{group.currencyCode}</Badge></TableCell><TableCell className={`text-end font-medium ${group.operating < 0 ? "text-destructive" : "text-primary"}`}>{formatAmount(group.operating, group.currencyCode)}</TableCell><TableCell className="text-end"><span className={group.netChange < 0 ? "text-destructive" : "text-primary"}>{formatAmount(group.netChange, group.currencyCode)}</span><span className="block text-xs text-muted-foreground">{t("app.cashFlow.closingCash")}: {formatAmount(group.closingCash, group.currencyCode)}</span></TableCell></TableRow>)}</TableBody></Table>
        </StatementTile>

        <StatementTile title={t("app.profitLoss.title")} description={t("app.financialStatements.periodDescription", { from: fromDate, to: toDate })} href={`/reports/profit-loss?${reportParams}`} icon={PieChart} isLoading={profitLoss.isLoading} isFetching={profitLoss.isFetching} error={profitLoss.error} isEmpty={profitLoss.groups.length === 0} onRefresh={() => void profitLoss.refetch()}>
          <Table className="min-w-[460px]">{tableHeader([t("app.financialStatements.branchCurrency"), t("app.profitLoss.kpis.revenue"), t("app.profitLoss.netProfit")])}<TableBody>{profitLoss.groups.map((group) => <TableRow key={group.key}><TableCell><span className="font-medium">{group.branchName}</span><Badge variant="outline" className="ms-2">{group.currencyCode}</Badge></TableCell><TableCell className="text-end font-medium">{formatAmount(group.revenue, group.currencyCode)}</TableCell><TableCell className="text-end"><span className={group.netProfit < 0 ? "text-destructive" : "text-primary"}>{formatAmount(group.netProfit, group.currencyCode)}</span><span className="block text-xs text-muted-foreground">{group.netMargin.toFixed(1)}% {t("app.profitLoss.netMargin")}</span></TableCell></TableRow>)}</TableBody></Table>
        </StatementTile>
      </div>

      <ZatcaReconciliationCard fromDate={fromDate} toDate={toDate} branchId={selectedBranchId} />

      <div className="flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-primary" />{t("app.financialStatements.currencyNote", { currency: displayCurrency, base: baseCurrency })}</div>
    </div>
  );
}