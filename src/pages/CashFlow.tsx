import { Fragment, useMemo, useState } from "react";
import { endOfDay, format, startOfMonth } from "date-fns";
import { ArrowDownRight, ArrowUpRight, Building2, CheckCircle2, Download, Info, TriangleAlert, Waves } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
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
import { useCashFlow, type CashFlowGroup, type CashFlowSection } from "@/hooks/useCashFlow";
import { useCurrency } from "@/hooks/useCurrency";

const SECTION_ORDER: CashFlowSection[] = ["operating", "investing", "financing"];

/** Parse a yyyy-MM-dd input value; returns null when the field is empty/invalid. */
const parseDayValue = (value: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function CashFlow() {
  const { tenant, hasFeature, loading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { t, i18n } = useTranslation();
  const { baseCurrency, displayCurrency, setDisplayCurrency, supportedCurrencies, convert, format: money, ratesLoading } = useCurrency();
  const [searchParams] = useSearchParams();
  const [fromDate, setFromDate] = useState(searchParams.get("from") ?? format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(searchParams.get("to") ?? format(endOfDay(new Date()), "yyyy-MM-dd"));
  const [branchValue, setBranchValue] = useState(searchParams.get("branch") ?? pinnedBranchId ?? activeBranchId ?? "all");
  const selectedBranchId = branchValue === "all" ? null : branchValue;
  const fromDateValue = parseDayValue(fromDate);
  const toDateValue = parseDayValue(toDate);
  const dayLabel = (value: Date | null) =>
    value ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(value) : "—";
  const { groups, isLoading, error } = useCashFlow(fromDateValue, toDateValue, selectedBranchId);

  const formatAmount = (amount: number, fromCurrency = baseCurrency) => money(amount, { showCode: true, fromCurrency });
  const consolidated = useMemo(() => {
    const total = (field: "operating" | "investing" | "financing" | "netChange" | "openingCash" | "closingCash" | "actualCashMovement" | "variance") =>
      groups.reduce((sum, group) => sum + convert(group[field], group.currencyCode), 0);
    return {
      operating: total("operating"), investing: total("investing"), financing: total("financing"),
      netChange: total("netChange"), openingCash: total("openingCash"), closingCash: total("closingCash"),
      actualCashMovement: total("actualCashMovement"), variance: total("variance"),
    };
  }, [convert, groups]);
  const balanced = Math.abs(consolidated.variance) < 0.01;
  const toneClass = (value: number) => value < 0 ? "text-destructive" : value > 0 ? "text-primary" : "text-muted-foreground";

  const exportCsv = () => {
    const rows = [
      [t("app.cashFlow.title"), tenant?.name ?? ""],
      [t("app.cashFlow.period"), `${fromDate} - ${toDate}`],
      [t("app.cashFlow.displayCurrency"), displayCurrency],
      [],
      [t("app.cashFlow.branch"), t("app.cashFlow.section"), t("app.cashFlow.code"), t("app.cashFlow.account"), t("app.cashFlow.movement"), t("app.cashFlow.cashImpact")],
    ];
    for (const group of groups) {
      for (const section of group.sections) {
        for (const line of section.lines) rows.push([group.branchName, t(`app.cashFlow.sections.${section.section}`), line.code, line.accountId.startsWith("net-income-") ? t("app.cashFlow.netIncome") : line.name, t(`app.cashFlow.details.${line.detail}`), line.cashImpact.toFixed(2)]);
      }
    }
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cash-flow-${fromDate}-${toDate}-${displayCurrency}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(t("app.cashFlow.exported"));
  };

  if (!loading && !hasFeature("accounting")) return <LockedFeatureScreen featureName={t("app.cashFlow.title")} />;

  const renderGroup = (group: CashFlowGroup) => (
    <Card key={group.key} className="overflow-hidden">
      <CardHeader className="border-b py-4">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="truncate">{group.branchName}</span><Badge variant="outline">{group.currencyCode}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[680px]">
            <TableHeader><TableRow><TableHead className="w-[90px]">{t("app.cashFlow.code")}</TableHead><TableHead>{t("app.cashFlow.account")}</TableHead><TableHead>{t("app.cashFlow.movement")}</TableHead><TableHead className="text-end">{t("app.cashFlow.cashImpact")}</TableHead></TableRow></TableHeader>
            <TableBody>
              {SECTION_ORDER.map((sectionKey) => {
                const section = group.sections.find((item) => item.section === sectionKey);
                if (!section) return null;
                return (
                  <Fragment key={sectionKey}>
                    <TableRow className="bg-muted/45 hover:bg-muted/45"><TableCell colSpan={3} className="py-2 text-xs font-semibold uppercase text-muted-foreground">{t(`app.cashFlow.sections.${sectionKey}`)}</TableCell><TableCell className={`py-2 text-end font-semibold tabular-nums ${toneClass(section.total)}`}>{formatAmount(section.total, group.currencyCode)}</TableCell></TableRow>
                    {section.lines.length === 0 ? <TableRow><TableCell colSpan={4} className="py-3 text-center text-xs text-muted-foreground">{t("app.cashFlow.noSectionMovements")}</TableCell></TableRow> : section.lines.map((line) => (
                      <TableRow key={line.accountId}><TableCell className="border-e border-border/50 font-mono text-xs text-muted-foreground">{line.code}</TableCell><TableCell>{line.accountId.startsWith("net-income-") ? t("app.cashFlow.netIncome") : line.name}</TableCell><TableCell className="text-muted-foreground">{t(`app.cashFlow.details.${line.detail}`)}</TableCell><TableCell className={`text-end font-medium tabular-nums ${toneClass(line.cashImpact)}`}>{formatAmount(line.cashImpact, group.currencyCode)}</TableCell></TableRow>
                    ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="grid grid-cols-3 border-t bg-muted/20 text-sm">
          <div className="p-3"><span className="block text-xs text-muted-foreground">{t("app.cashFlow.openingCash")}</span><strong className="tabular-nums">{formatAmount(group.openingCash, group.currencyCode)}</strong></div>
          <div className="border-x p-3"><span className="block text-xs text-muted-foreground">{t("app.cashFlow.netChange")}</span><strong className={`tabular-nums ${toneClass(group.netChange)}`}>{formatAmount(group.netChange, group.currencyCode)}</strong></div>
          <div className="p-3"><span className="block text-xs text-muted-foreground">{t("app.cashFlow.closingCash")}</span><strong className="tabular-nums">{formatAmount(group.closingCash, group.currencyCode)}</strong></div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="container mx-auto max-w-7xl space-y-5 py-5 md:space-y-6 md:py-7">
      <header className="flex min-h-[56px] flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1"><h1 className="flex items-center gap-2 font-display text-2xl font-semibold md:text-3xl"><Waves className="h-7 w-7 text-primary" />{t("app.cashFlow.title")}<Badge variant="secondary" className="gap-1 font-normal"><Info className="h-3 w-3" />{t("app.cashFlow.indirectMethod")}</Badge></h1><p className="mt-1 text-sm text-muted-foreground">{t("app.cashFlow.subtitle", { from: dayLabel(fromDateValue), to: dayLabel(toDateValue) })}</p></div>
        <div className="data-panel flex flex-wrap items-center gap-2 p-2">
          {canSwitchBranches && <Select value={branchValue} onValueChange={setBranchValue}><SelectTrigger className="h-9 w-[180px]"><Building2 className="me-1.5 h-3.5 w-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("app.cashFlow.allBranches")}</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</SelectContent></Select>}
          <Input aria-label={t("app.cashFlow.fromDate")} type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-9 w-[150px]" />
          <Input aria-label={t("app.cashFlow.toDate")} type="date" value={toDate} min={fromDate} max={format(new Date(), "yyyy-MM-dd")} onChange={(event) => setToDate(event.target.value)} className="h-9 w-[150px]" />
          <Select value={displayCurrency} onValueChange={setDisplayCurrency}><SelectTrigger aria-label={t("app.cashFlow.displayCurrency")} className="h-9 w-[110px]"><SelectValue /></SelectTrigger><SelectContent>{supportedCurrencies.map((currency) => <SelectItem key={currency.code} value={currency.code}>{currency.code}</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={isLoading || groups.length === 0}><Download className="h-3.5 w-3.5" />{t("app.cashFlow.exportCsv")}</Button>
        </div>
      </header>

      <Alert><Info className="h-4 w-4" /><AlertTitle>{t("app.cashFlow.indirectMethod")}</AlertTitle><AlertDescription>{t("app.cashFlow.methodDescription")} <Link to="/reports/trial-balance" className="underline underline-offset-2">{t("app.cashFlow.openTrialBalance")}</Link></AlertDescription></Alert>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{(["operating", "investing", "financing", "netChange"] as const).map((key) => <Card key={key}><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">{t(`app.cashFlow.kpis.${key}`)}</p>{isLoading || ratesLoading ? <Skeleton className="mt-2 h-7 w-28" /> : <p className={`mt-1 text-xl font-semibold tabular-nums ${toneClass(consolidated[key])}`}>{formatAmount(consolidated[key], displayCurrency)}</p>}</CardContent></Card>)}</div>

      {!isLoading && groups.length > 0 && <Alert variant={balanced ? "default" : "destructive"}>{balanced ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}<AlertTitle>{balanced ? t("app.cashFlow.reconciled") : t("app.cashFlow.unexplainedVariance")}</AlertTitle><AlertDescription>{t("app.cashFlow.reconciliation", { actual: formatAmount(consolidated.actualCashMovement, displayCurrency), activities: formatAmount(consolidated.netChange, displayCurrency), variance: formatAmount(consolidated.variance, displayCurrency) })}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><TriangleAlert className="h-4 w-4" /><AlertTitle>{t("app.cashFlow.loadFailed")}</AlertTitle><AlertDescription>{error instanceof Error ? error.message : t("app.cashFlow.tryAgain")}</AlertDescription></Alert>}

      {isLoading ? <Card><CardContent className="space-y-2 p-6">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}</CardContent></Card> : groups.length === 0 ? <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">{t("app.cashFlow.noMovements")}</CardContent></Card> : <div className={`grid min-w-0 gap-5 ${branchValue === "all" && groups.length > 1 ? "xl:grid-cols-2" : "grid-cols-1"}`}>{groups.map(renderGroup)}</div>}

      {groups.length > 0 && <Card className="overflow-hidden"><CardHeader className="border-b"><CardTitle className="text-base">{t("app.cashFlow.cashReconciliation")}</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><Table className="min-w-[760px]"><TableHeader><TableRow><TableHead>{t("app.cashFlow.branch")}</TableHead><TableHead>{t("app.cashFlow.cashAccount")}</TableHead><TableHead className="text-end">{t("app.cashFlow.opening")}</TableHead><TableHead className="text-end">{t("app.cashFlow.movement")}</TableHead><TableHead className="text-end">{t("app.cashFlow.closing")}</TableHead></TableRow></TableHeader><TableBody>{groups.flatMap((group) => group.cashAccounts.map((account) => <TableRow key={`${group.key}:${account.accountId}`}><TableCell>{group.branchName}<Badge variant="outline" className="ms-2 text-[10px]">{group.currencyCode}</Badge></TableCell><TableCell><span className="me-2 font-mono text-xs text-muted-foreground">{account.code}</span>{account.name}</TableCell><TableCell className="text-end tabular-nums">{formatAmount(account.opening, group.currencyCode)}</TableCell><TableCell className={`text-end tabular-nums ${toneClass(account.movement)}`}>{account.movement < 0 ? <ArrowDownRight className="me-1 inline h-3.5 w-3.5" /> : <ArrowUpRight className="me-1 inline h-3.5 w-3.5" />}{formatAmount(account.movement, group.currencyCode)}</TableCell><TableCell className="text-end font-medium tabular-nums">{formatAmount(account.closing, group.currencyCode)}</TableCell></TableRow>))}</TableBody></Table></CardContent></Card>}
      <p className="text-xs text-muted-foreground">{t("app.cashFlow.currencyNote", { base: baseCurrency, display: displayCurrency })}</p>
    </div>
  );
}