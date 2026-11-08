import { useMemo, useState } from "react";
import { endOfDay, format, startOfMonth } from "date-fns";
import { Building2, Download, CreditCard, RefreshCw, TriangleAlert } from "lucide-react";
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
import { mergeCashCardSections, useCashCardAnalysis } from "@/hooks/useCashCardAnalysis";

const parseDayValue = (value: string) => {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function CashCardAnalysis() {
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { t, i18n } = useTranslation();
  const { displayCurrency, setDisplayCurrency, supportedCurrencies, convert, format: money, ratesLoading } = useCurrency();

  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfDay(new Date()), "yyyy-MM-dd"));
  const [branchValue, setBranchValue] = useState(pinnedBranchId ?? activeBranchId ?? "all");

  const selectedBranchId = branchValue === "all" ? null : branchValue;
  const { data: report, isLoading, isFetching, error, refetch } = useCashCardAnalysis(fromDate, toDate, selectedBranchId);
  // Multi-currency tenants: convert each currency section before combining.
  const data = useMemo(
    () => mergeCashCardSections(report.sections ?? [report], convert, displayCurrency),
    [report, convert, displayCurrency],
  );

  const base = data.currency;
  const amount = (value: number) =>
    Number.isFinite(value) ? money(convert(value, base), { showCode: true, fromCurrency: displayCurrency }) : "—";
  const count = (value: number) => value.toLocaleString(i18n.language);
  const pct = (value: number, of: number) => (of === 0 ? "0.0%" : `${((value / of) * 100).toFixed(1)}%`);

  const dayLabel = (value: string) => {
    const parsed = parseDayValue(value);
    return parsed ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(parsed) : value;
  };

  const cash = useMemo(() => data.methods.find((m) => m.method === "cash"), [data.methods]);
  const card = useMemo(() => data.methods.find((m) => m.method === "card"), [data.methods]);

  const weekdayLabel = (dow: number) => {
    const reference = new Date(Date.UTC(2024, 0, 1 + (dow - 1)));
    return new Intl.DateTimeFormat(i18n.language, { weekday: "long", timeZone: "UTC" }).format(reference);
  };

  const exportCsv = () => {
    const rows: (string | number)[][] = [];
    rows.push([t("app.cashCard.daily"), "", "", "", "", ""]);
    rows.push([
      t("app.cashCard.date"),
      t("app.cashCard.cash"),
      t("app.cashCard.card"),
      t("app.cashCard.other"),
      t("app.cashCard.total"),
      t("app.cashCard.transactions"),
      t("app.cashCard.avgTicket"),
    ]);
    data.daily.forEach((row) => rows.push([
      row.date,
      row.cash.toFixed(2),
      row.card.toFixed(2),
      row.other.toFixed(2),
      row.total.toFixed(2),
      row.transactions,
      row.avgTicket.toFixed(2),
    ]));
    rows.push([]);
    rows.push([t("app.cashCard.byBranch")]);
    rows.push([
      t("app.cashCard.branch"),
      t("app.cashCard.currency"),
      t("app.cashCard.cash"),
      t("app.cashCard.card"),
      t("app.cashCard.other"),
      t("app.cashCard.total"),
      t("app.cashCard.transactions"),
    ]);
    data.branches.forEach((row) => rows.push([
      row.branchName,
      row.currencyCode,
      row.cash.toFixed(2),
      row.card.toFixed(2),
      row.other.toFixed(2),
      row.total.toFixed(2),
      row.transactions,
    ]));
    const csv = rows
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" }));
    anchor.download = `cash-card-analysis-${fromDate}-${toDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    toast.success(t("app.cashCard.exportCsv"));
  };

  const totals = data.totals;
  const dailyAvgSales = totals.days === 0 ? 0 : totals.sales / totals.days;
  const dailyAvgTx = totals.days === 0 ? 0 : totals.transactions / totals.days;
  const smallTickets = data.bands
    .filter((band) => band.band === "0-5")
    .reduce((sum, band) => sum + band.transactions, 0);

  const kpis: [string, string][] = [
    ["totalSales", amount(totals.sales)],
    ["cashSales", amount(cash?.sales ?? 0)],
    ["cardSales", amount(card?.sales ?? 0)],
    ["transactions", count(totals.transactions)],
    ["avgTicket", amount(totals.avgTicket)],
    ["medianTicket", amount(totals.medianTicket)],
    ["dailyAvgSales", amount(dailyAvgSales)],
    ["dailyAvgTransactions", dailyAvgTx.toFixed(0)],
  ];

  return (
    <div className="container mx-auto max-w-7xl space-y-5 py-5 md:space-y-6 md:py-7">
      <header className="flex min-h-[56px] flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-semibold md:text-3xl">
            <CreditCard className="h-7 w-7 text-primary" />
            {t("app.cashCard.title")}
            <Badge variant="secondary" className="font-normal">{t("app.cashCard.badge")}</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("app.cashCard.subtitle", { from: dayLabel(fromDate), to: dayLabel(toDate) })}
          </p>
        </div>
        <div className="data-panel flex flex-wrap items-center gap-2 p-2">
          {canSwitchBranches && (
            <Select value={branchValue} onValueChange={setBranchValue}>
              <SelectTrigger aria-label={t("app.cashCard.branch")} className="h-9 w-[180px]">
                <Building2 className="me-1.5 h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("app.cashCard.allBranches")}</SelectItem>
                {branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Input aria-label={t("app.cashCard.fromDate")} type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-9 w-[150px]" />
          <Input aria-label={t("app.cashCard.toDate")} type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} className="h-9 w-[150px]" />
          <Select value={displayCurrency} onValueChange={setDisplayCurrency}>
            <SelectTrigger aria-label={t("app.cashCard.displayCurrency")} className="h-9 w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{supportedCurrencies.map((currency) => <SelectItem key={currency.code} value={currency.code}>{currency.code}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />{t("app.cashCard.refresh")}
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={isLoading || totals.transactions === 0}>
            <Download className="h-3.5 w-3.5" />{t("app.cashCard.exportCsv")}
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>{t("app.cashCard.loadFailed")}</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : t("app.cashCard.tryAgain")}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([key, value]) => (
          <Card key={key}>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">{t(`app.cashCard.kpis.${key}`)}</p>
              {isLoading || ratesLoading ? <Skeleton className="mt-2 h-7 w-28" /> : <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <Card><CardContent className="space-y-2 p-6">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}</CardContent></Card>
      ) : totals.transactions === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">{t("app.cashCard.noActivity")}</CardContent></Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader className="border-b py-4"><CardTitle className="text-base">{t("app.cashCard.paymentMix")}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader><TableRow>
                    <TableHead>{t("app.cashCard.method")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.sales")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.salesShare")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.transactions")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.txShare")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.avgTicket")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.medianTicket")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.methods.map((row) => (
                      <TableRow key={row.method}>
                        <TableCell className="font-medium capitalize">{t(`app.cashCard.methods.${row.method}`, { defaultValue: row.method })}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.sales)}</TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">{pct(row.sales, totals.sales)}</TableCell>
                        <TableCell className="text-end tabular-nums">{count(row.transactions)}</TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">{pct(row.transactions, totals.transactions)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.avgTicket)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.medianTicket)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b py-4"><CardTitle className="text-base">{t("app.cashCard.byBranch")}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader><TableRow>
                    <TableHead>{t("app.cashCard.branch")}</TableHead>
                    <TableHead>{t("app.cashCard.currency")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.cash")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.card")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.other")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.total")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.transactions")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.avgTicket")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.branches.map((row) => (
                      <TableRow key={row.branchId ?? "unassigned"}>
                        <TableCell className="font-medium">{row.branchName}</TableCell>
                        <TableCell><Badge variant="outline">{row.currencyCode}</Badge></TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.cash)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.card)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.other)}</TableCell>
                        <TableCell className="text-end font-medium tabular-nums">{amount(row.total)}</TableCell>
                        <TableCell className="text-end tabular-nums">{count(row.transactions)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.avgTicket)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b py-4"><CardTitle className="text-base">{t("app.cashCard.daily")}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[520px] overflow-auto">
                <Table className="min-w-[760px]">
                  <TableHeader className="sticky top-0 bg-background"><TableRow>
                    <TableHead>{t("app.cashCard.date")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.cash")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.card")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.other")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.total")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.transactions")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.avgTicket")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.daily.map((row) => (
                      <TableRow key={row.date}>
                        <TableCell className="font-medium">{dayLabel(row.date)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.cash)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.card)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.other)}</TableCell>
                        <TableCell className="text-end font-medium tabular-nums">{amount(row.total)}</TableCell>
                        <TableCell className="text-end tabular-nums">{count(row.transactions)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.avgTicket)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader className="border-b py-4"><CardTitle className="text-base">{t("app.cashCard.ticketBands")}</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t("app.cashCard.band")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.cash")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.card")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.transactions")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.txShare")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.bands.map((row) => (
                      <TableRow key={row.band}>
                        <TableCell className="font-medium tabular-nums">{row.band}</TableCell>
                        <TableCell className="text-end tabular-nums">{count(row.cashTransactions)}</TableCell>
                        <TableCell className="text-end tabular-nums">{count(row.cardTransactions)}</TableCell>
                        <TableCell className="text-end tabular-nums">{count(row.transactions)}</TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">{pct(row.transactions, totals.transactions)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className="border-b py-4"><CardTitle className="text-base">{t("app.cashCard.byWeekday")}</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t("app.cashCard.weekday")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.cash")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.card")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.total")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.transactions")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.weekdays.map((row) => (
                      <TableRow key={row.dow}>
                        <TableCell className="font-medium">{weekdayLabel(row.dow)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.cash)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.card)}</TableCell>
                        <TableCell className="text-end font-medium tabular-nums">{amount(row.total)}</TableCell>
                        <TableCell className="text-end tabular-nums">{count(row.transactions)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="border-b py-4"><CardTitle className="text-base">{t("app.cashCard.byHour")}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader><TableRow>
                    <TableHead>{t("app.cashCard.hour")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.cash")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.card")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.total")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.transactions")}</TableHead>
                    <TableHead className="text-end">{t("app.cashCard.avgTicket")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.hours.map((row) => (
                      <TableRow key={row.hour}>
                        <TableCell className="font-medium tabular-nums">{`${String(row.hour).padStart(2, "0")}:00`}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.cash)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.card)}</TableCell>
                        <TableCell className="text-end font-medium tabular-nums">{amount(row.total)}</TableCell>
                        <TableCell className="text-end tabular-nums">{count(row.transactions)}</TableCell>
                        <TableCell className="text-end tabular-nums">{amount(row.avgTicket)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            {t("app.cashCard.smallTicketNote", { pct: pct(smallTickets, totals.transactions) })}
          </p>
        </>
      )}
    </div>
  );
}
