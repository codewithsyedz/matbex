import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { Building2, CheckCircle2, Download, Landmark, Scale, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
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
import { useBalanceSheet, type BalanceSheetLine, type BalanceSheetSection } from "@/hooks/useBalanceSheet";
import { useCurrency } from "@/hooks/useCurrency";

const SECTION_ORDER: BalanceSheetSection[] = ["asset", "liability", "equity"];

export default function BalanceSheet() {
  const { tenant, hasFeature, loading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const {
    baseCurrency,
    displayCurrency,
    setDisplayCurrency,
    supportedCurrencies,
    format: money,
    convert,
    ratesLoading,
  } = useCurrency();
  const requestedAsOfDate = searchParams.get("asOf");
  const earningsFromDate = searchParams.get("earningsFrom") ?? undefined;
  const requestedBranchId = searchParams.get("branch");
  const [asOfDate, setAsOfDate] = useState(requestedAsOfDate ?? format(new Date(), "yyyy-MM-dd"));
  const [branchValue, setBranchValue] = useState(requestedBranchId ?? pinnedBranchId ?? activeBranchId ?? "all");
  const selectedBranchId = branchValue === "all" ? null : branchValue;
  const { groups, isLoading, error } = useBalanceSheet(asOfDate, selectedBranchId, earningsFromDate);
  // Branches may keep their books in different currencies, so every branch
  // total is converted into the display currency before it is summed.
  const consolidated = useMemo(() => {
    const total = (field: "assets" | "liabilities" | "equity") =>
      groups.reduce((sum, group) => sum + convert(group[field], group.currencyCode), 0);
    const assets = total("assets");
    const liabilities = total("liabilities");
    const equity = total("equity");
    return { assets, liabilities, equity, variance: assets - liabilities - equity };
  }, [convert, groups]);
  const isBalanced = Math.abs(consolidated.variance) < 0.01;

  const labels: Record<BalanceSheetSection, string> = {
    asset: t("app.balanceSheet.sections.assets"),
    liability: t("app.balanceSheet.sections.liabilities"),
    equity: t("app.balanceSheet.sections.equity"),
  };

  const consolidatedLines = useMemo(() => {
    const map = new Map<string, BalanceSheetLine>();
    for (const group of groups) {
      for (const line of group.lines) {
        const key = `${line.section}:${line.accountId.startsWith("accumulated-earnings-") ? "accumulated-earnings" : line.accountId}`;
        const current = map.get(key);
        const converted = convert(line.balance, group.currencyCode);
        if (current) current.balance += converted;
        else map.set(key, { ...line, accountId: key, balance: converted, currencyCode: displayCurrency, branchName: t("app.balanceSheet.allBranches") });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }, [convert, displayCurrency, groups, t]);

  const formatAmount = (amount: number, fromCurrency = baseCurrency) =>
    money(amount, { showCode: true, fromCurrency });

  const exportCsv = () => {
    const lines = [
      `"${t("app.balanceSheet.title")}","${tenant?.name ?? ""}"`,
      `"${t("app.balanceSheet.asOf")}",${asOfDate}`,
      `"${t("app.balanceSheet.displayCurrency")}",${displayCurrency}`,
      "",
      `"${t("app.balanceSheet.branch")}","${t("app.balanceSheet.section")}","${t("app.balanceSheet.code")}","${t("app.balanceSheet.account")}","${t("app.balanceSheet.amount")}","${t("app.balanceSheet.displayCurrency")}"`,
    ];
    for (const group of groups) {
      for (const line of group.lines) {
        lines.push([
          group.branchName,
          labels[line.section],
          line.accountCode,
          line.accountName,
          line.balance.toFixed(2),
          group.currencyCode,
        ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `balance-sheet-${asOfDate}-${displayCurrency}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(t("app.balanceSheet.exported"));
  };

  if (!loading && !hasFeature("accounting")) {
    return <LockedFeatureScreen featureName={t("app.balanceSheet.title")} />;
  }

  const renderSection = (section: BalanceSheetSection, lines: BalanceSheetLine[], currency: string) => {
    const sectionLines = lines.filter((line) => line.section === section);
    const total = sectionLines.reduce((sum, line) => sum + line.balance, 0);
    return (
      <Fragment key={section}>
        <TableRow className="bg-muted/45 hover:bg-muted/45">
          <TableCell colSpan={2} className="py-2 text-xs font-semibold uppercase text-muted-foreground">
            {labels[section]}
          </TableCell>
          <TableCell className="py-2 text-end text-sm font-semibold tabular-nums">
            {formatAmount(total, currency)}
          </TableCell>
        </TableRow>
        {sectionLines.map((line) => (
          <TableRow key={line.accountId} className={line.isDerived ? "bg-primary/5" : undefined}>
            <TableCell className="w-[110px] border-e border-border/50 font-mono text-xs text-muted-foreground">
              {line.accountCode}
            </TableCell>
            <TableCell className="min-w-[220px]">
              {line.derivedKind === "retained" ? t("app.balanceSheet.retainedEarnings") : line.derivedKind === "currentPeriod" ? t("app.balanceSheet.currentPeriodEarnings") : line.isDerived ? t("app.balanceSheet.accumulatedEarnings") : line.accountName}
              {line.isDerived && <Badge variant="secondary" className="ms-2 text-[10px]">{t("app.balanceSheet.computed")}</Badge>}
            </TableCell>
            <TableCell className="text-end font-medium tabular-nums">
              {formatAmount(line.balance, currency)}
            </TableCell>
          </TableRow>
        ))}
      </Fragment>
    );
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-5 py-5 md:space-y-6 md:py-7">
      <header className="flex min-h-[56px] flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold md:text-3xl">
            <Landmark className="h-7 w-7 text-primary" />
            {t("app.balanceSheet.title")}
            <Badge variant="secondary" className="gap-1 font-normal">
              <Scale className="h-3 w-3" /> {t("app.balanceSheet.fromLedger")}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {earningsFromDate ? t("app.balanceSheet.reconciliationSubtitle", { from: format(new Date(`${earningsFromDate}T12:00:00`), "PPP"), date: format(new Date(`${asOfDate}T12:00:00`), "PPP") }) : t("app.balanceSheet.subtitle", { date: format(new Date(`${asOfDate}T12:00:00`), "PPP") })}
          </p>
        </div>
        <div className="data-panel flex flex-wrap items-center gap-2 p-2">
          {canSwitchBranches ? (
            <Select value={branchValue} onValueChange={setBranchValue}>
              <SelectTrigger className="h-9 w-[180px]"><Building2 className="me-1.5 h-3.5 w-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("app.balanceSheet.allBranches")}</SelectItem>
                {branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Input aria-label={t("app.balanceSheet.asOf")} type="date" value={asOfDate} max={format(new Date(), "yyyy-MM-dd")} onChange={(event) => setAsOfDate(event.target.value)} className="h-9 w-[155px]" />
          <Select value={displayCurrency} onValueChange={setDisplayCurrency}>
            <SelectTrigger aria-label={t("app.balanceSheet.displayCurrency")} className="h-9 w-[115px]"><SelectValue /></SelectTrigger>
            <SelectContent>{supportedCurrencies.map((currency) => <SelectItem key={currency.code} value={currency.code}>{currency.code}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={isLoading || groups.length === 0}>
            <Download className="h-3.5 w-3.5" /> {t("app.balanceSheet.exportCsv")}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [t("app.balanceSheet.sections.assets"), consolidated.assets],
          [t("app.balanceSheet.sections.liabilities"), consolidated.liabilities],
          [t("app.balanceSheet.sections.equity"), consolidated.equity],
          [t("app.balanceSheet.equationVariance"), consolidated.variance],
        ].map(([label, value]) => (
          <Card key={String(label)}><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">{label}</p>{isLoading || ratesLoading ? <Skeleton className="mt-2 h-7 w-28" /> : <p className="mt-1 text-xl font-semibold tabular-nums">{formatAmount(Number(value), displayCurrency)}</p>}</CardContent></Card>
        ))}
      </div>

      {!isLoading && (
        <Alert variant={isBalanced ? "default" : "destructive"}>
          {isBalanced ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
          <AlertTitle>{isBalanced ? t("app.balanceSheet.balanced") : t("app.balanceSheet.outOfBalance")}</AlertTitle>
          <AlertDescription>{t("app.balanceSheet.equation", { assets: formatAmount(consolidated.assets, displayCurrency), liabilities: formatAmount(consolidated.liabilities, displayCurrency), equity: formatAmount(consolidated.equity, displayCurrency) })}</AlertDescription>
        </Alert>
      )}

      {error ? <Alert variant="destructive"><TriangleAlert className="h-4 w-4" /><AlertTitle>{t("app.balanceSheet.loadFailed")}</AlertTitle><AlertDescription>{error instanceof Error ? error.message : t("app.balanceSheet.tryAgain")}</AlertDescription></Alert> : null}

      {isLoading ? <Card><CardContent className="space-y-2 p-6">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}</CardContent></Card> : groups.length === 0 ? <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">{t("app.balanceSheet.noBalances")}</CardContent></Card> : (
        <div className={`grid min-w-0 gap-5 ${branchValue === "all" && groups.length > 1 ? "xl:grid-cols-2" : "grid-cols-1"}`}>
          {branchValue === "all" && (
            <Card className={`min-w-0 overflow-hidden ${groups.length > 1 ? "xl:col-span-2" : ""}`}>
              <CardHeader className="border-b"><CardTitle className="flex items-center justify-between text-base"><span>{t("app.balanceSheet.consolidated")}</span><Badge variant="outline">{displayCurrency}</Badge></CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0"><Table className="min-w-[620px]"><TableHeader><TableRow><TableHead>{t("app.balanceSheet.code")}</TableHead><TableHead>{t("app.balanceSheet.account")}</TableHead><TableHead className="text-end">{t("app.balanceSheet.amount")}</TableHead></TableRow></TableHeader><TableBody>{SECTION_ORDER.map((section) => renderSection(section, consolidatedLines, displayCurrency))}</TableBody></Table></CardContent>
            </Card>
          )}
          {groups.map((group) => (
            <Card key={group.key} className="min-w-0 overflow-hidden">
              <CardHeader className="border-b"><CardTitle className="flex items-center justify-between gap-3 text-base"><span className="truncate">{group.branchName}</span><Badge variant="outline">{group.currencyCode}</Badge></CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0"><Table className="min-w-[560px]"><TableHeader><TableRow><TableHead>{t("app.balanceSheet.code")}</TableHead><TableHead>{t("app.balanceSheet.account")}</TableHead><TableHead className="text-end">{t("app.balanceSheet.amount")}</TableHead></TableRow></TableHeader><TableBody>{SECTION_ORDER.map((section) => renderSection(section, group.lines, group.currencyCode))}<TableRow className="border-t-2 bg-muted/25 font-semibold"><TableCell colSpan={2}>{t("app.balanceSheet.equationVariance")}</TableCell><TableCell className="text-end tabular-nums">{formatAmount(group.variance, group.currencyCode)}</TableCell></TableRow></TableBody></Table></CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("app.balanceSheet.currencyNote", { base: baseCurrency, display: displayCurrency })}</p>
    </div>
  );
}