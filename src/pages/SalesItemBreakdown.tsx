import { useMemo, useState } from "react";
import { endOfDay, format, startOfMonth } from "date-fns";
import { Building2, Download, Info, Package, Search, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useSalesItemBreakdown, type SalesItemGroup } from "@/hooks/useSalesItemBreakdown";

export default function SalesItemBreakdown() {
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { t, i18n } = useTranslation();
  const { baseCurrency, displayCurrency, setDisplayCurrency, supportedCurrencies, convert, format: money, ratesLoading } = useCurrency();

  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfDay(new Date()), "yyyy-MM-dd"));
  const [branchValue, setBranchValue] = useState(pinnedBranchId ?? activeBranchId ?? "all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const selectedBranchId = branchValue === "all" ? null : branchValue;
  const { groups, isLoading, error } = useSalesItemBreakdown(fromDate, toDate, selectedBranchId);

  const categories = useMemo(() => {
    const set = new Set<string>();
    groups.forEach((group) => group.rows.forEach((row) => set.add(row.category)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [groups]);

  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups
      .map((group) => {
        const rows = group.rows.filter((row) =>
          (category === "all" || row.category === category) &&
          (term === "" || row.itemName.toLowerCase().includes(term) || row.category.toLowerCase().includes(term)));
        const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
        const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
        const cost = rows.reduce((sum, row) => sum + (row.totalCost ?? 0), 0);
        const costCoverage = rows.reduce((sum, row) => sum + (row.totalCost === null ? 0 : row.revenue), 0);
        const grossProfit = costCoverage - cost;
        return {
          ...group,
          rows,
          quantity,
          revenue,
          cost,
          costCoverage,
          grossProfit,
          marginPct: costCoverage === 0 ? 0 : (grossProfit / costCoverage) * 100,
        } satisfies SalesItemGroup;
      })
      .filter((group) => group.rows.length > 0);
  }, [category, groups, search]);

  const consolidated = useMemo(() => {
    const quantity = filteredGroups.reduce((sum, group) => sum + group.quantity, 0);
    const revenue = filteredGroups.reduce((sum, group) => sum + convert(group.revenue, group.currencyCode), 0);
    const cost = filteredGroups.reduce((sum, group) => sum + convert(group.cost, group.currencyCode), 0);
    const coverage = filteredGroups.reduce((sum, group) => sum + convert(group.costCoverage, group.currencyCode), 0);
    const grossProfit = coverage - cost;
    return { quantity, revenue, cost, grossProfit, margin: coverage === 0 ? 0 : (grossProfit / coverage) * 100 };
  }, [convert, filteredGroups]);

  const formatAmount = (amount: number, fromCurrency = displayCurrency) => money(amount, { showCode: true, fromCurrency });
  const formatDate = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));

  const exportCsv = () => {
    if (filteredGroups.length === 0) return;
    const header = [
      t("app.salesItemBreakdown.branch"),
      t("app.salesItemBreakdown.item"),
      t("app.salesItemBreakdown.category"),
      "Currency",
      t("app.salesItemBreakdown.qtySold"),
      t("app.salesItemBreakdown.orders"),
      t("app.salesItemBreakdown.revenue"),
      t("app.salesItemBreakdown.unitCost"),
      t("app.salesItemBreakdown.totalCost"),
      t("app.salesItemBreakdown.grossProfit"),
      t("app.salesItemBreakdown.margin"),
    ];
    const rows = filteredGroups.flatMap((group) => group.rows.map((row) => [
      group.branchName,
      row.itemName,
      row.category,
      row.currencyCode,
      row.quantity,
      row.transactionCount,
      row.revenue.toFixed(2),
      row.unitCost === null ? "" : row.unitCost.toFixed(2),
      row.totalCost === null ? "" : row.totalCost.toFixed(2),
      row.grossProfit === null ? "" : row.grossProfit.toFixed(2),
      row.marginPct === null ? "" : `${row.marginPct.toFixed(1)}%`,
    ]));
    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" }));
    anchor.download = `sales-item-breakdown-${fromDate}-${toDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    toast.success(t("app.salesItemBreakdown.exportCsv"));
  };

  const renderGroup = (group: SalesItemGroup) => (
    <Card key={group.key} className="overflow-hidden">
      <CardHeader className="border-b py-4">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />{group.branchName}</span>
          <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            <Badge variant="outline">{group.currencyCode}</Badge>
            {formatAmount(convert(group.revenue, group.currencyCode), displayCurrency)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[880px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("app.salesItemBreakdown.item")}</TableHead>
                <TableHead>{t("app.salesItemBreakdown.category")}</TableHead>
                <TableHead className="text-end">{t("app.salesItemBreakdown.qtySold")}</TableHead>
                <TableHead className="text-end">{t("app.salesItemBreakdown.orders")}</TableHead>
                <TableHead className="text-end">{t("app.salesItemBreakdown.revenue")}</TableHead>
                <TableHead className="text-end">{t("app.salesItemBreakdown.unitCost")}</TableHead>
                <TableHead className="text-end">{t("app.salesItemBreakdown.totalCost")}</TableHead>
                <TableHead className="text-end">{t("app.salesItemBreakdown.grossProfit")}</TableHead>
                <TableHead className="text-end">{t("app.salesItemBreakdown.margin")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((row) => (
                <TableRow key={`${group.key}-${row.menuItemId ?? row.itemName}`}>
                  <TableCell className="font-medium">{row.itemName}</TableCell>
                  <TableCell className="text-muted-foreground">{row.category}</TableCell>
                  <TableCell className="text-end tabular-nums">{row.quantity.toLocaleString(i18n.language)}</TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">{row.transactionCount.toLocaleString(i18n.language)}</TableCell>
                  <TableCell className="text-end font-medium tabular-nums">{formatAmount(convert(row.revenue, row.currencyCode), displayCurrency)}</TableCell>
                  <TableCell className="text-end tabular-nums">{row.unitCost === null ? <span className="text-xs text-muted-foreground">{t("app.salesItemBreakdown.noCost")}</span> : formatAmount(convert(row.unitCost, row.currencyCode), displayCurrency)}</TableCell>
                  <TableCell className="text-end tabular-nums">{row.totalCost === null ? "—" : formatAmount(convert(row.totalCost, row.currencyCode), displayCurrency)}</TableCell>
                  <TableCell className={`text-end tabular-nums ${row.grossProfit !== null && row.grossProfit < 0 ? "text-destructive" : ""}`}>{row.grossProfit === null ? "—" : formatAmount(convert(row.grossProfit, row.currencyCode), displayCurrency)}</TableCell>
                  <TableCell className="text-end tabular-nums">{row.marginPct === null ? "—" : `${row.marginPct.toFixed(1)}%`}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/30 font-medium">
                <TableCell colSpan={2}>{t("app.salesItemBreakdown.totals")}</TableCell>
                <TableCell className="text-end tabular-nums">{group.quantity.toLocaleString(i18n.language)}</TableCell>
                <TableCell />
                <TableCell className="text-end tabular-nums">{formatAmount(convert(group.revenue, group.currencyCode), displayCurrency)}</TableCell>
                <TableCell />
                <TableCell className="text-end tabular-nums">{formatAmount(convert(group.cost, group.currencyCode), displayCurrency)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatAmount(convert(group.grossProfit, group.currencyCode), displayCurrency)}</TableCell>
                <TableCell className="text-end tabular-nums">{group.marginPct.toFixed(1)}%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="container mx-auto max-w-7xl space-y-5 py-5 md:space-y-6 md:py-7">
      <header className="flex min-h-[56px] flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-semibold md:text-3xl">
            <Package className="h-7 w-7 text-primary" />
            {t("app.salesItemBreakdown.title")}
            <Badge variant="secondary" className="gap-1 font-normal"><Info className="h-3 w-3" />{t("app.salesItemBreakdown.badge")}</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("app.salesItemBreakdown.subtitle", { from: formatDate(fromDate), to: formatDate(toDate) })}</p>
        </div>
        <div className="data-panel flex flex-wrap items-center gap-2 p-2">
          {canSwitchBranches && (
            <Select value={branchValue} onValueChange={setBranchValue}>
              <SelectTrigger aria-label={t("app.salesItemBreakdown.branch")} className="h-9 w-[180px]"><Building2 className="me-1.5 h-3.5 w-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("app.salesItemBreakdown.allBranches")}</SelectItem>
                {branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Input aria-label={t("app.salesItemBreakdown.fromDate")} type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-9 w-[150px]" />
          <Input aria-label={t("app.salesItemBreakdown.toDate")} type="date" value={toDate} min={fromDate} max={format(new Date(), "yyyy-MM-dd")} onChange={(event) => setToDate(event.target.value)} className="h-9 w-[150px]" />
          <Select value={displayCurrency} onValueChange={setDisplayCurrency}>
            <SelectTrigger aria-label={t("app.salesItemBreakdown.displayCurrency")} className="h-9 w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{supportedCurrencies.map((currency) => <SelectItem key={currency.code} value={currency.code}>{currency.code}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={isLoading || filteredGroups.length === 0}><Download className="h-3.5 w-3.5" />{t("app.salesItemBreakdown.exportCsv")}</Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {([
          ["quantity", consolidated.quantity.toLocaleString(i18n.language)],
          ["revenue", formatAmount(consolidated.revenue, displayCurrency)],
          ["cost", formatAmount(consolidated.cost, displayCurrency)],
          ["grossProfit", formatAmount(consolidated.grossProfit, displayCurrency)],
          ["margin", `${consolidated.margin.toFixed(1)}%`],
        ] as const).map(([key, value]) => (
          <Card key={key}>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">{t(`app.salesItemBreakdown.kpis.${key}`)}</p>
              {isLoading || ratesLoading ? <Skeleton className="mt-2 h-7 w-28" /> : <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="data-panel flex flex-wrap items-center gap-2 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-3.5 w-3.5 text-muted-foreground" />
          <Input aria-label={t("app.salesItemBreakdown.search")} placeholder={t("app.salesItemBreakdown.search")} value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 ps-9" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger aria-label={t("app.salesItemBreakdown.category")} className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("app.salesItemBreakdown.allCategories")}</SelectItem>
            {categories.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>{t("app.salesItemBreakdown.loadFailed")}</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : t("app.salesItemBreakdown.tryAgain")}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <Card><CardContent className="space-y-2 p-6">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}</CardContent></Card>
      ) : filteredGroups.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">{t("app.salesItemBreakdown.noActivity")}</CardContent></Card>
      ) : (
        <div className="grid min-w-0 gap-5 grid-cols-1">{filteredGroups.map(renderGroup)}</div>
      )}

      <p className="text-xs text-muted-foreground">{t("app.salesItemBreakdown.costNote")}</p>
      <p className="text-xs text-muted-foreground">{t("app.salesItemBreakdown.currencyNote", { base: baseCurrency, display: displayCurrency })}</p>
    </div>
  );
}
