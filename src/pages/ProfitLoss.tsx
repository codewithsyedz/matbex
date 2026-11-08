import { Fragment, useMemo, useState } from "react";
import { endOfDay, format, startOfMonth } from "date-fns";
import { ArrowRight, Building2, CheckCircle2, ChevronDown, ChevronRight, Download, Info, LineChart, ReceiptText, Scale, TriangleAlert } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { ZatcaReconciliationCard } from "@/components/reports/ZatcaReconciliationCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useBalanceSheet } from "@/hooks/useBalanceSheet";
import { useProfitLossReport, type ProfitLossExpenseLine, type ProfitLossGroup, type ProfitLossLine, type ProfitLossSection } from "@/hooks/useProfitLossReport";

const SECTION_ORDER: ProfitLossSection[] = ["revenue", "cogs", "expense"];

/** Parse a yyyy-MM-dd input value; returns null when the field is empty/invalid. */
const parseDayValue = (value: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function ProfitLoss() {
  const { tenant, hasFeature, loading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { t, i18n } = useTranslation();
  const { baseCurrency, displayCurrency, setDisplayCurrency, supportedCurrencies, convert, format: money, ratesLoading } = useCurrency();
  const [searchParams] = useSearchParams();
  const [fromDate, setFromDate] = useState(searchParams.get("from") ?? format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(searchParams.get("to") ?? format(endOfDay(new Date()), "yyyy-MM-dd"));
  const [branchValue, setBranchValue] = useState(searchParams.get("branch") ?? pinnedBranchId ?? activeBranchId ?? "all");
  const dayLabel = (value: string) => {
    const parsed = parseDayValue(value);
    return parsed ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(parsed) : "—";
  };
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const selectedBranchId = branchValue === "all" ? null : branchValue;
  const { groups, isLoading, error } = useProfitLossReport(fromDate, toDate, selectedBranchId);
  const { groups: balanceSheetGroups, isLoading: reconciliationLoading, error: reconciliationError } = useBalanceSheet(toDate, selectedBranchId, fromDate);

  const consolidated = useMemo(() => {
    const total = (field: "revenue" | "cogs" | "grossProfit" | "expenses" | "netProfit") =>
      groups.reduce((sum, group) => sum + convert(group[field], group.currencyCode), 0);
    const revenue = total("revenue");
    const cogs = total("cogs");
    const grossProfit = total("grossProfit");
    const expenses = total("expenses");
    const netProfit = total("netProfit");
    return {
      revenue,
      cogs,
      grossProfit,
      expenses,
      netProfit,
      grossMargin: revenue !== 0 ? (grossProfit / revenue) * 100 : 0,
      netMargin: revenue !== 0 ? (netProfit / revenue) * 100 : 0,
    };
  }, [convert, groups]);

  const consolidatedLines = useMemo(() => {
    const lines = new Map<string, ProfitLossLine>();
    for (const group of groups) {
      for (const line of group.lines) {
        const key = `${line.section}:${line.accountId}`;
        const amount = convert(line.amount, group.currencyCode);
        const current = lines.get(key);
        if (current) current.amount += amount;
        else lines.set(key, { ...line, accountId: key, amount });
      }
    }
    return Array.from(lines.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [convert, groups]);

  const consolidatedExpenseLines = useMemo(() => groups.flatMap((group) => group.expenseLines.map((line) => ({
    ...line,
    accountId: `expense:${line.accountId}`,
    branchName: group.branchName,
    currencyCode: displayCurrency,
    amount: convert(line.amount, group.currencyCode),
  }))), [convert, displayCurrency, groups]);

  const reconciliations = useMemo(() => groups.map((group) => {
    const balanceSheet = balanceSheetGroups.find((candidate) => candidate.branchId === group.branchId && candidate.currencyCode === group.currencyCode);
    const currentPeriodEarnings = balanceSheet?.currentPeriodEarnings ?? 0;
    const variance = group.netProfit - currentPeriodEarnings;
    return {
      key: group.key,
      branchId: group.branchId,
      branchName: group.branchName,
      currencyCode: group.currencyCode,
      netProfit: group.netProfit,
      retainedEarnings: balanceSheet?.retainedEarnings ?? 0,
      currentPeriodEarnings,
      totalEquity: balanceSheet?.equity ?? 0,
      variance,
      reconciled: Boolean(balanceSheet) && Math.abs(variance) < 0.01,
    };
  }), [balanceSheetGroups, groups]);

  const labels: Record<ProfitLossSection, string> = {
    revenue: t("app.profitLoss.sections.revenue"),
    cogs: t("app.profitLoss.sections.cogs"),
    expense: t("app.profitLoss.sections.expenses"),
  };
  const formatAmount = (amount: number, fromCurrency = displayCurrency) => money(amount, { showCode: true, fromCurrency });
  const toneClass = (value: number) => value < 0 ? "text-destructive" : value > 0 ? "text-primary" : "text-muted-foreground";

  const aggregateExpenseLines = (lines: ProfitLossExpenseLine[], accountId: string) => {
    const matching = lines.filter((line) => line.accountId === accountId);
    const grouped = new Map<string, ProfitLossExpenseLine>();
    for (const line of matching.filter((item) => item.isExpenseSource)) {
      const key = line.referenceId ?? line.transactionId;
      const current = grouped.get(key);
      if (current) current.amount += line.amount;
      else grouped.set(key, { ...line });
    }
    const adjustments = matching.filter((line) => !line.isExpenseSource);
    const adjustmentAmount = adjustments.reduce((sum, line) => sum + line.amount, 0);
    const result = Array.from(grouped.values()).filter((line) => Math.abs(line.amount) >= 0.005);
    if (Math.abs(adjustmentAmount) >= 0.005) {
      const first = adjustments[0];
      if (first) result.push({ ...first, transactionId: `adjustment:${accountId}`, description: t("app.profitLoss.ledgerAdjustment"), referenceId: null, paymentMethod: null, supplierName: null, amount: adjustmentAmount });
    }
    return result.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  };

  const toggleAccount = (key: string) => setExpandedAccounts((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      [t("app.profitLoss.title"), tenant?.name ?? ""],
      [t("app.profitLoss.period"), `${fromDate} - ${toDate}`],
      [t("app.profitLoss.displayCurrency"), displayCurrency],
      [],
      [t("app.profitLoss.branch"), t("app.profitLoss.currency"), t("app.profitLoss.section"), t("app.profitLoss.code"), t("app.profitLoss.account"), t("app.profitLoss.amount")],
    ];
    for (const group of groups) {
      for (const line of group.lines) {
        rows.push([group.branchName, group.currencyCode, labels[line.section], line.code, line.name, line.amount.toFixed(2)]);
        if (line.section === "expense") {
          for (const detail of aggregateExpenseLines(group.expenseLines, line.accountId)) {
            rows.push([group.branchName, group.currencyCode, t("app.profitLoss.expenseDetails"), detail.transactionDate, detail.description, detail.amount.toFixed(2)]);
          }
        }
      }
      rows.push([group.branchName, group.currencyCode, t("app.profitLoss.netProfit"), "", "", group.netProfit.toFixed(2)]);
    }
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `profit-loss-${fromDate}-${toDate}-${displayCurrency}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(t("app.profitLoss.exported"));
  };

  if (!loading && !hasFeature("accounting")) return <LockedFeatureScreen featureName={t("app.profitLoss.title")} />;

  const renderStatement = (group: Pick<ProfitLossGroup, "key" | "branchName" | "currencyCode" | "lines" | "expenseLines" | "revenue" | "cogs" | "grossProfit" | "expenses" | "netProfit" | "grossMargin" | "netMargin">) => (
    <Card key={group.key} className="overflow-hidden">
      <CardHeader className="border-b py-4"><CardTitle className="flex items-center justify-between gap-3 text-base"><span className="truncate">{group.branchName}</span><Badge variant="outline">{group.currencyCode}</Badge></CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[600px]">
            <TableHeader><TableRow><TableHead className="w-[100px]">{t("app.profitLoss.code")}</TableHead><TableHead>{t("app.profitLoss.account")}</TableHead><TableHead className="text-end">{t("app.profitLoss.amount")}</TableHead></TableRow></TableHeader>
            <TableBody>
              {SECTION_ORDER.map((section) => {
                const sectionLines = group.lines.filter((line) => line.section === section);
                const total = sectionLines.reduce((sum, line) => sum + line.amount, 0);
                return (
                  <Fragment key={section}>
                    <TableRow className="bg-muted/45 hover:bg-muted/45"><TableCell colSpan={2} className="py-2 text-xs font-semibold uppercase text-muted-foreground">{labels[section]}</TableCell><TableCell className="py-2 text-end font-semibold tabular-nums">{formatAmount(total, group.currencyCode)}</TableCell></TableRow>
                    {sectionLines.length === 0 ? <TableRow><TableCell colSpan={3} className="py-3 text-center text-xs text-muted-foreground">{t("app.profitLoss.noSectionActivity")}</TableCell></TableRow> : sectionLines.map((line) => {
                      const accountKey = `${group.key}:${line.accountId}`;
                      const expenseDetails = line.section === "expense" ? aggregateExpenseLines(group.expenseLines, line.accountId) : [];
                      const isExpanded = expandedAccounts.has(accountKey);
                      return (
                        <Fragment key={line.accountId}>
                          <TableRow className={line.section === "expense" && expenseDetails.length > 0 ? "cursor-pointer" : undefined} onClick={() => expenseDetails.length > 0 && toggleAccount(accountKey)}>
                            <TableCell className="border-e border-border/50 font-mono text-xs text-muted-foreground">{line.code}</TableCell>
                            <TableCell>
                              <div className="flex min-w-0 items-center gap-2">
                                {line.section === "expense" && expenseDetails.length > 0 && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t(`app.profitLoss.${isExpanded ? "hideExpenseDetails" : "showExpenseDetails"}`, { account: line.name })} aria-expanded={isExpanded} onClick={(event) => { event.stopPropagation(); toggleAccount(accountKey); }}>{isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}</Button>}
                                <span className="truncate">{line.name}</span>
                                {line.section === "expense" && expenseDetails.length > 0 && <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{expenseDetails.length}</Badge>}
                              </div>
                            </TableCell>
                            <TableCell className="text-end font-medium tabular-nums">{formatAmount(line.amount, group.currencyCode)}</TableCell>
                          </TableRow>
                          {isExpanded && expenseDetails.map((detail) => (
                            <TableRow key={detail.transactionId} className="bg-muted/20 hover:bg-muted/30">
                              <TableCell className="border-e border-border/50 ps-8 font-mono text-[11px] text-muted-foreground">{new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }).format(new Date(`${detail.transactionDate}T12:00:00`))}</TableCell>
                              <TableCell className="py-2 ps-10">
                                <div className="flex min-w-0 items-start gap-2"><ReceiptText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="truncate text-sm font-medium">{detail.description}</p><p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground"><span>{detail.branchName}</span>{detail.supplierName && <span>{detail.supplierName}</span>}{detail.paymentMethod && <span>{t(`app.profitLoss.paymentMethods.${detail.paymentMethod}`, { defaultValue: detail.paymentMethod })}</span>}<span>{detail.referenceId ? t("app.profitLoss.expenseReference", { reference: detail.referenceId.slice(0, 8).toUpperCase() }) : t("app.profitLoss.ledgerAdjustmentDescription")}</span></p></div></div>
                              </TableCell>
                              <TableCell className={`py-2 text-end text-sm font-medium tabular-nums ${detail.amount < 0 ? "text-destructive" : ""}`}>{formatAmount(detail.amount, group.currencyCode)}</TableCell>
                            </TableRow>
                          ))}
                        </Fragment>
                      );
                    })}
                    {section === "cogs" && <TableRow className="border-t bg-primary/5 font-semibold"><TableCell colSpan={2}>{t("app.profitLoss.grossProfit")}</TableCell><TableCell className={`text-end tabular-nums ${toneClass(group.grossProfit)}`}>{formatAmount(group.grossProfit, group.currencyCode)}</TableCell></TableRow>}
                  </Fragment>
                );
              })}
              <TableRow className="border-t-2 bg-muted/25 text-base font-semibold"><TableCell colSpan={2}>{t("app.profitLoss.netProfit")}</TableCell><TableCell className={`text-end tabular-nums ${toneClass(group.netProfit)}`}>{formatAmount(group.netProfit, group.currencyCode)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
        <div className="grid grid-cols-2 border-t bg-muted/20 text-sm"><div className="p-3"><span className="block text-xs text-muted-foreground">{t("app.profitLoss.grossMargin")}</span><strong className="tabular-nums">{group.grossMargin.toFixed(1)}%</strong></div><div className="border-s p-3"><span className="block text-xs text-muted-foreground">{t("app.profitLoss.netMargin")}</span><strong className={`tabular-nums ${toneClass(group.netMargin)}`}>{group.netMargin.toFixed(1)}%</strong></div></div>
      </CardContent>
    </Card>
  );

  const consolidatedGroup = { key: "consolidated", branchName: t("app.profitLoss.consolidated"), currencyCode: displayCurrency, lines: consolidatedLines, expenseLines: consolidatedExpenseLines, ...consolidated };

  return (
    <div className="container mx-auto max-w-7xl space-y-5 py-5 md:space-y-6 md:py-7">
      <header className="flex min-h-[56px] flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1"><h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-semibold md:text-3xl"><LineChart className="h-7 w-7 text-primary" />{t("app.profitLoss.title")}<Badge variant="secondary" className="gap-1 font-normal"><Info className="h-3 w-3" />{t("app.profitLoss.fromLedger")}</Badge></h1><p className="mt-1 text-sm text-muted-foreground">{t("app.profitLoss.subtitle", { from: dayLabel(fromDate), to: dayLabel(toDate) })}</p></div>
        <div className="data-panel flex flex-wrap items-center gap-2 p-2">
          {canSwitchBranches && <Select value={branchValue} onValueChange={setBranchValue}><SelectTrigger className="h-9 w-[180px]"><Building2 className="me-1.5 h-3.5 w-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("app.profitLoss.allBranches")}</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectContent></Select>}
          <Input aria-label={t("app.profitLoss.fromDate")} type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-9 w-[150px]" />
          <Input aria-label={t("app.profitLoss.toDate")} type="date" value={toDate} min={fromDate} max={format(new Date(), "yyyy-MM-dd")} onChange={(event) => setToDate(event.target.value)} className="h-9 w-[150px]" />
          <Select value={displayCurrency} onValueChange={setDisplayCurrency}><SelectTrigger aria-label={t("app.profitLoss.displayCurrency")} className="h-9 w-[110px]"><SelectValue /></SelectTrigger><SelectContent>{supportedCurrencies.map((currency) => <SelectItem key={currency.code} value={currency.code}>{currency.code}</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={isLoading || groups.length === 0}><Download className="h-3.5 w-3.5" />{t("app.profitLoss.exportCsv")}</Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{(["revenue", "cogs", "grossProfit", "expenses", "netProfit"] as const).map((key) => <Card key={key}><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">{t(`app.profitLoss.kpis.${key}`)}</p>{isLoading || ratesLoading ? <Skeleton className="mt-2 h-7 w-28" /> : <p className={`mt-1 text-xl font-semibold tabular-nums ${key === "netProfit" || key === "grossProfit" ? toneClass(consolidated[key]) : ""}`}>{formatAmount(consolidated[key], displayCurrency)}</p>}</CardContent></Card>)}</div>

      {error && <Alert variant="destructive"><TriangleAlert className="h-4 w-4" /><AlertTitle>{t("app.profitLoss.loadFailed")}</AlertTitle><AlertDescription>{error instanceof Error ? error.message : t("app.profitLoss.tryAgain")}</AlertDescription></Alert>}
      <Card className="overflow-hidden">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex flex-col gap-3 text-base sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2"><Scale className="h-4 w-4 text-primary" />{t("app.profitLoss.reconciliation.title")}</span>
            <Button asChild variant="outline" size="sm" className="w-full gap-1.5 sm:w-auto">
              <Link to={`/reports/balance-sheet?${new URLSearchParams({ ...(selectedBranchId ? { branch: selectedBranchId } : {}), asOf: toDate, earningsFrom: fromDate }).toString()}`}>{t("app.profitLoss.reconciliation.openBalanceSheet")}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /></Link>
            </Button>
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("app.profitLoss.reconciliation.description")}</p>
        </CardHeader>
        <CardContent className="p-0">
          {reconciliationLoading ? <div className="space-y-2 p-5">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}</div> : reconciliationError ? <Alert variant="destructive" className="m-4"><TriangleAlert className="h-4 w-4" /><AlertTitle>{t("app.profitLoss.reconciliation.loadFailed")}</AlertTitle></Alert> : (
            <div className="overflow-x-auto">
              <Table className="min-w-[860px]">
                <TableHeader><TableRow><TableHead>{t("app.profitLoss.branch")}</TableHead><TableHead className="text-end">{t("app.profitLoss.netProfit")}</TableHead><TableHead className="text-end">{t("app.profitLoss.reconciliation.retainedEarnings")}</TableHead><TableHead className="text-end">{t("app.profitLoss.reconciliation.currentPeriodEarnings")}</TableHead><TableHead className="text-end">{t("app.profitLoss.reconciliation.totalEquity")}</TableHead><TableHead className="text-end">{t("app.profitLoss.reconciliation.variance")}</TableHead><TableHead className="text-end">{t("app.profitLoss.reconciliation.status")}</TableHead></TableRow></TableHeader>
                <TableBody>{reconciliations.map((row) => <TableRow key={row.key}><TableCell><span className="font-medium">{row.branchName}</span><Badge variant="outline" className="ms-2">{row.currencyCode}</Badge></TableCell><TableCell className="text-end font-medium tabular-nums">{formatAmount(row.netProfit, row.currencyCode)}</TableCell><TableCell className="text-end tabular-nums">{formatAmount(row.retainedEarnings, row.currencyCode)}</TableCell><TableCell className="text-end font-medium tabular-nums">{formatAmount(row.currentPeriodEarnings, row.currencyCode)}</TableCell><TableCell className="text-end tabular-nums">{formatAmount(row.totalEquity, row.currencyCode)}</TableCell><TableCell className={`text-end font-medium tabular-nums ${row.reconciled ? "text-primary" : "text-destructive"}`}>{formatAmount(row.variance, row.currencyCode)}</TableCell><TableCell className="text-end"><Badge variant={row.reconciled ? "secondary" : "destructive"} className="gap-1">{row.reconciled ? <CheckCircle2 className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}{t(`app.profitLoss.reconciliation.${row.reconciled ? "reconciled" : "review"}`)}</Badge></TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      {isLoading ? <Card><CardContent className="space-y-2 p-6">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}</CardContent></Card> : groups.length === 0 ? <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">{t("app.profitLoss.noActivity")}</CardContent></Card> : <div className={`grid min-w-0 gap-5 ${branchValue === "all" && groups.length > 1 ? "xl:grid-cols-2" : "grid-cols-1"}`}>{branchValue === "all" && <div className={groups.length > 1 ? "min-w-0 xl:col-span-2" : "min-w-0"}>{renderStatement(consolidatedGroup)}</div>}{groups.map((group) => <div key={group.key} className="min-w-0">{renderStatement(group)}</div>)}</div>}
      <ZatcaReconciliationCard fromDate={fromDate} toDate={toDate} branchId={selectedBranchId} />
      <p className="text-xs text-muted-foreground">{t("app.profitLoss.currencyNote", { base: baseCurrency, display: displayCurrency })}</p>
    </div>
  );
}