import { useEffect, useMemo, useState } from "react";
import { endOfDay, format, startOfMonth } from "date-fns";
import { Building2, ChevronLeft, ChevronRight, Download, Info, RefreshCw, ScrollText, Search, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useSalesJournal } from "@/hooks/useSalesJournal";

const PAGE_SIZES = [50, 100, 200];

export default function SalesJournal() {
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { t, i18n } = useTranslation();
  const { format: money } = useCurrency();

  const [fromDate, setFromDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(endOfDay(new Date()), "yyyy-MM-dd"));
  const [branchValue, setBranchValue] = useState(pinnedBranchId ?? activeBranchId ?? "all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [fromDate, toDate, branchValue, pageSize]);

  const selectedBranchId = branchValue === "all" ? null : branchValue;
  const { rows, totalRows, isLoading, isFetching, error, refetch } = useSalesJournal({
    fromDate,
    toDate,
    branchId: selectedBranchId,
    search,
    page,
    pageSize,
  });

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }), [i18n.language]);
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { timeStyle: "short" }), [i18n.language]);
  const formatDay = (value: string) => dateFormatter.format(new Date(`${value}T12:00:00`));

  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const rangeFrom = totalRows === 0 ? 0 : page * pageSize + 1;
  const rangeTo = Math.min(totalRows, page * pageSize + rows.length);

  const exportCsv = () => {
    if (rows.length === 0) return;
    const header = [
      t("app.salesJournal.date"),
      t("app.salesJournal.time"),
      t("app.salesJournal.branch"),
      t("app.salesJournal.receipt"),
      t("app.salesJournal.item"),
      t("app.salesJournal.category"),
      t("app.salesJournal.qty"),
      t("app.salesJournal.unitPrice"),
      t("app.salesJournal.lineTotal"),
      t("app.salesJournal.currency"),
      t("app.salesJournal.paymentMethod"),
    ];
    const body = rows.map((row) => [
      row.businessDate,
      timeFormatter.format(new Date(row.soldAt)),
      row.branchName,
      row.receiptNumber,
      row.hasItemDetail ? row.itemName : t("app.salesJournal.noItemDetail"),
      row.category,
      row.quantity,
      row.unitPrice.toFixed(2),
      row.lineTotal.toFixed(2),
      row.currencyCode,
      row.paymentMethod,
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" }));
    anchor.download = `sales-journal-${fromDate}-${toDate}-p${page + 1}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    toast.success(t("app.salesJournal.exportCsv"));
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-5 py-5 md:space-y-6 md:py-7">
      <header className="flex min-h-[56px] flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-semibold md:text-3xl">
            <ScrollText className="h-7 w-7 text-primary" />
            {t("app.salesJournal.title")}
            <Badge variant="secondary" className="gap-1 font-normal"><Info className="h-3 w-3" />{t("app.salesJournal.badge")}</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("app.salesJournal.subtitle", { from: formatDay(fromDate), to: formatDay(toDate) })}</p>
        </div>
        <div className="data-panel flex flex-wrap items-center gap-2 p-2">
          {canSwitchBranches && (
            <Select value={branchValue} onValueChange={setBranchValue}>
              <SelectTrigger aria-label={t("app.salesJournal.branch")} className="h-9 w-[180px]"><Building2 className="me-1.5 h-3.5 w-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("app.salesJournal.allBranches")}</SelectItem>
                {branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Input aria-label={t("app.salesJournal.fromDate")} type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-9 w-[150px]" />
          <Input aria-label={t("app.salesJournal.toDate")} type="date" value={toDate} min={fromDate} max={format(new Date(), "yyyy-MM-dd")} onChange={(event) => setToDate(event.target.value)} className="h-9 w-[150px]" />
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />{t("app.salesJournal.refresh")}
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={isLoading || rows.length === 0}><Download className="h-3.5 w-3.5" />{t("app.salesJournal.exportCsv")}</Button>
        </div>
      </header>

      <div className="data-panel flex flex-wrap items-center gap-2 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-3.5 w-3.5 text-muted-foreground" />
          <Input aria-label={t("app.salesJournal.search")} placeholder={t("app.salesJournal.search")} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="h-9 ps-9" />
        </div>
        <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
          <SelectTrigger aria-label={t("app.salesJournal.pageSize")} className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>{PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{t("app.salesJournal.showing", { from: rangeFrom, to: rangeTo, total: totalRows })}</span>
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>{t("app.salesJournal.loadFailed")}</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : t("app.salesJournal.tryAgain")}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">{Array.from({ length: 10 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">{t("app.salesJournal.noActivity")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>{t("app.salesJournal.date")}</TableHead>
                    <TableHead>{t("app.salesJournal.time")}</TableHead>
                    <TableHead>{t("app.salesJournal.branch")}</TableHead>
                    <TableHead>{t("app.salesJournal.receipt")}</TableHead>
                    <TableHead>{t("app.salesJournal.item")}</TableHead>
                    <TableHead>{t("app.salesJournal.category")}</TableHead>
                    <TableHead className="text-end">{t("app.salesJournal.qty")}</TableHead>
                    <TableHead className="text-end">{t("app.salesJournal.unitPrice")}</TableHead>
                    <TableHead className="text-end">{t("app.salesJournal.lineTotal")}</TableHead>
                    <TableHead>{t("app.salesJournal.currency")}</TableHead>
                    <TableHead>{t("app.salesJournal.paymentMethod")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.lineId}>
                      <TableCell className="whitespace-nowrap">{formatDay(row.businessDate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{timeFormatter.format(new Date(row.soldAt))}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.branchName}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{row.receiptNumber || "—"}</TableCell>
                      <TableCell className="font-medium">
                        {row.hasItemDetail ? row.itemName : <span className="text-muted-foreground">{t("app.salesJournal.noItemDetail")}</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.category}</TableCell>
                      <TableCell className="text-end tabular-nums">{row.quantity.toLocaleString(i18n.language)}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(row.unitPrice, { fromCurrency: row.currencyCode })}</TableCell>
                      <TableCell className="text-end font-medium tabular-nums">{money(row.lineTotal, { fromCurrency: row.currencyCode })}</TableCell>
                      <TableCell><Badge variant="outline">{row.currencyCode}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{row.paymentMethod || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("app.salesJournal.lines", { count: totalRows })}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0 || isFetching}>
            <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />{t("app.salesJournal.previous")}
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">{page + 1} / {pageCount}</span>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setPage((value) => value + 1)} disabled={page + 1 >= pageCount || isFetching}>
            {t("app.salesJournal.next")}<ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
