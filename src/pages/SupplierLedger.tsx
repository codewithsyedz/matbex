import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  BookOpen,
  CalendarIcon,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Mail,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { usePersistedDateRange } from "@/hooks/usePersistedDateRange";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { useSupplierLedger } from "@/hooks/useSupplierLedger";
import { SupplierApHeadGapCard } from "@/components/accounting/SupplierApHeadGapCard";
import { SupplierApAccountHistoryCard } from "@/components/accounting/SupplierApAccountHistoryCard";
import { exportSupplierLedgerPdf, renderSupplierLedgerPdfBase64 } from "@/lib/supplierLedgerPdf";
import { db } from "@/integrations/db/client";
import { useTranslation } from "react-i18next";
import { ar, enUS } from "date-fns/locale";

interface SupplierPostingRow {
  entries: number;
  postedEntries: number;
  unpostedEntries: number;
  unbalancedEntries: number;
  postingStatus: "complete" | "unbalanced" | "gaps" | "none";
}

function SupplierPostingBadge({ row }: { row: SupplierPostingRow }) {
  const { t } = useTranslation();
  if (row.postingStatus === "unbalanced") {
    return (
      <Badge variant="destructive" className="font-normal">
        {t("reports.supplierLedger.posting.unbalanced", { count: row.unbalancedEntries })}
      </Badge>
    );
  }
  if (row.postingStatus === "none") {
    return (
      <Badge variant="outline" className="font-normal text-destructive">
        {t("reports.supplierLedger.posting.none", { count: row.unpostedEntries })}
      </Badge>
    );
  }
  if (row.postingStatus === "gaps") {
    return (
      <Badge variant="outline" className="font-normal text-amber-600">
        {t("reports.supplierLedger.posting.gaps", { posted: row.postedEntries, entries: row.entries })}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-primary/40 font-normal text-primary">
      {t("reports.supplierLedger.posting.all", { count: row.entries })}
    </Badge>
  );
}

export default function SupplierLedger() {
  const { tenant, hasFeature, loading, user } = useAuth();
  const [isEmailing, setIsEmailing] = useState(false);
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("ar") ? ar : enUS;

  const [supplierId, setSupplierId] = useState<string>("all");
  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  // Default to 1 Aug 2026 so historical posted expenses from the opening period
  // appear as rows; the user's own picks persist across sessions.
  const { from, to, setFrom, setTo, reset: resetRange } = usePersistedDateRange(
    "supplier-ledger",
    { from: new Date(2026, 7, 1), to: new Date() },
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const {
    suppliers,
    entries,
    rows,
    totalBilled,
    totalSettled,
    totalOpen,
    unpostedCount,
    unbalancedCount,
    isLoading,
  } = useSupplierLedger({ supplierId, from, to, branchId });

  const branchScopeLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? t("reports.supplierLedger.allBranches")
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const handleExportCsv = () => {
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(`Supplier Ledger,${tenant?.name ?? ""}`);
    lines.push(`Period,${format(from, "yyyy-MM-dd")} to ${format(to, "yyyy-MM-dd")}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push("");
    lines.push(
      [
        "Supplier",
        "Expense Date",
        "Description",
        "Branch",
        "Entry Date",
        "Account Code",
        "Account Name",
        "Debit",
        "Credit",
        "Line Description",
        "Status",
      ].join(","),
    );
    for (const e of entries) {
      if (e.lines.length === 0) {
        lines.push(
          [
            esc(e.supplierName),
            e.expenseDate,
            esc(e.description),
            esc(e.branchName ?? t("reports.supplierLedger.unassigned")),
            "",
            "",
            "NOT POSTED",
            "",
            "",
            "",
            "unposted",
          ].join(","),
        );
        continue;
      }
      for (const l of e.lines) {
        lines.push(
          [
            esc(e.supplierName),
            e.expenseDate,
            esc(e.description),
            esc(e.branchName ?? t("reports.supplierLedger.unassigned")),
            l.date,
            esc(l.accountCode),
            esc(l.accountName),
            l.debit.toFixed(2),
            l.credit.toFixed(2),
            esc(l.description ?? ""),
            l.isVoided ? "voided" : "posted",
          ].join(","),
        );
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `supplier-ledger-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Supplier ledger exported");
  };

  const buildPdfArgs = () => ({
      restaurantName: tenant?.name ?? "Restaurant",
      branchLabel: branchScopeLabel,
      periodLabel: `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`,
      supplierLabel: selectedSupplier?.name ?? "All suppliers",
      payableHead: selectedSupplier?.apAccountCode
        ? `${selectedSupplier.apAccountCode} - ${selectedSupplier.apAccountName}`
        : null,
      rows: rows.map((r) => ({
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        entries: r.entries,
        postedEntries: r.postedEntries,
        billed: r.billed,
        settled: r.settled,
        open: r.open,
      })),
      entries,
      totals: {
        billed: totalBilled,
        settled: totalSettled,
        open: totalOpen,
        entries: entries.length,
        unposted: unpostedCount,
        unbalanced: unbalancedCount,
      },
    fileName: `supplier-ledger-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}.pdf`,
  });

  const handleExportPdf = async () => {
    try {
      await exportSupplierLedgerPdf(buildPdfArgs());
      toast.success("Supplier ledger PDF exported");
    } catch (err) {
      console.error(err);
      toast.error("Could not generate the PDF");
    }
  };

  const handleEmailPdf = async () => {
    if (!user?.email) {
      toast.error("Your account has no email address on file");
      return;
    }
    setIsEmailing(true);
    try {
      const args = buildPdfArgs();
      const pdfBase64 = await renderSupplierLedgerPdfBase64(args);
      const { data, error } = await db.functions.invoke("email-report-pdf", {
        body: {
          pdf_base64: pdfBase64,
          file_name: args.fileName,
          report_title: `{t("reports.supplierLedger.title")} - ${args.supplierLabel}`,
          subtitle: `${args.branchLabel} - ${args.periodLabel}`,
        },
      });
      if (error) throw error;
      if (data && (data as { error?: string }).error) {
        throw new Error((data as { error?: string }).error);
      }
      toast.success(`Supplier ledger emailed to ${user.email}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not email the report");
    } finally {
      setIsEmailing(false);
    }
  };

  if (!loading && !hasFeature("accounting")) {
    return (
      <LockedFeatureScreen
        featureName={t("reports.supplierLedger.title")}
        description="See every posted debit and credit account behind each supplier expense."
        featureKey="accounting"
      />
    );
  }

  const DatePick = ({
    value,
    onChange,
    label,
  }: {
    value: Date;
    onChange: (d: Date) => void;
    label: string;
  }) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5" />
          {label} {format(value, "PP", { locale: dateLocale })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && onChange(d)}
          initialFocus
          className="pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-primary" />
            {t("reports.supplierLedger.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("reports.supplierLedger.description", { branch: branchScopeLabel })}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger className="h-9 w-[210px]">
              <SelectValue placeholder={t("reports.supplierLedger.supplier")} />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">{t("reports.supplierLedger.allSuppliers")}</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder={t("reports.supplierLedger.branch")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("reports.supplierLedger.allBranches")}</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DatePick value={from} onChange={setFrom} label={t("reports.supplierLedger.from")} />
          <DatePick value={to} onChange={setTo} label={t("reports.supplierLedger.to")} />

          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5"
            onClick={resetRange}
            title={t("reports.supplierLedger.resetTitle")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("reports.supplierLedger.reset")}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleExportCsv}
            disabled={isLoading || entries.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            {t("reports.supplierLedger.exportCsv")}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleExportPdf}
            disabled={isLoading || entries.length === 0}
          >
            <FileText className="h-3.5 w-3.5" />
            {t("reports.supplierLedger.exportPdf")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleEmailPdf}
            disabled={isLoading || entries.length === 0 || isEmailing}
          >
            {isEmailing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
            {isEmailing ? t("reports.supplierLedger.sending") : t("reports.supplierLedger.emailMe")}
          </Button>
        </div>
      </header>

      <SupplierApHeadGapCard />

      {selectedSupplier && (
        <p className="text-sm text-muted-foreground">
          {t("reports.supplierLedger.payableHead")}{" "}
          {selectedSupplier.apAccountCode ? (
            <span className="font-medium text-foreground">
              {selectedSupplier.apAccountCode} · {selectedSupplier.apAccountName}
            </span>
          ) : (
            <span className="text-amber-600">
              {t("reports.supplierLedger.headPending")}
            </span>
          )}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t("reports.supplierLedger.billed")}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totalBilled)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t("reports.supplierLedger.settled")}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totalSettled)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t("reports.supplierLedger.open")}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totalOpen)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{t("reports.supplierLedger.entriesPeriod")}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{entries.length}</p>
          </CardContent>
        </Card>
      </div>

      {(unpostedCount > 0 || unbalancedCount > 0) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          {unpostedCount > 0 && (
            <span>
              {t("reports.supplierLedger.unposted", { count: unpostedCount })}
            </span>
          )}
          {unbalancedCount > 0 && (
            <span>
              {t("reports.supplierLedger.unbalanced", { count: unbalancedCount })}
            </span>
          )}
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">{t("reports.supplierLedger.bySupplier")}</CardTitle>
          <CardDescription>
            {t("reports.supplierLedger.bySupplierDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {t("reports.supplierLedger.noSupplier")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.supplierLedger.columns.supplier")}</TableHead>
                  <TableHead>{t("reports.supplierLedger.columns.posting")}</TableHead>
                  <TableHead className="text-end">{t("reports.supplierLedger.columns.entries")}</TableHead>
                  <TableHead className="text-end">{t("reports.supplierLedger.columns.billed")}</TableHead>
                  <TableHead className="text-end">{t("reports.supplierLedger.columns.settled")}</TableHead>
                  <TableHead className="text-end">{t("reports.supplierLedger.columns.open")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.supplierId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSupplierId(r.supplierId)}
                  >
                    <TableCell className="font-medium">{r.supplierName}</TableCell>
                    <TableCell>
                      <SupplierPostingBadge row={r} />
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{r.entries}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmt(r.billed)}</TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">
                      {r.settled > 0.005 ? fmt(r.settled) : "-"}
                    </TableCell>
                    <TableCell className="text-end font-semibold tabular-nums">
                      {fmt(r.open)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 bg-muted/50 hover:bg-muted/50">
                  <TableCell className="font-semibold">{t("reports.supplierLedger.total")}</TableCell>
                  <TableCell />
                  <TableCell className="text-end font-semibold tabular-nums">
                    {entries.length}
                  </TableCell>
                  <TableCell className="text-end font-semibold tabular-nums">
                    {fmt(totalBilled)}
                  </TableCell>
                  <TableCell className="text-end font-semibold tabular-nums">
                    {fmt(totalSettled)}
                  </TableCell>
                  <TableCell className="text-end font-semibold tabular-nums">
                    {fmt(totalOpen)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">{t("reports.supplierLedger.postedEntries")}</CardTitle>
          <CardDescription>
            {t("reports.supplierLedger.postedDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {t("reports.supplierLedger.nothing")}
            </div>
          ) : (
            <ScrollArea className="max-h-[70vh]">
              <div className="divide-y">
                {entries.map((e) => {
                  const open = !!expanded[e.expenseId];
                  return (
                    <div key={e.expenseId}>
                      <button
                        type="button"
                        onClick={() => toggle(e.expenseId)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/50 min-h-[52px]"
                      >
                        {open ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-[240px] flex-1">
                          <p className="truncate text-sm font-medium">
                            {e.supplierName}
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {e.description || t("reports.supplierLedger.expense")}
                            </span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {e.expenseDate} · {e.branchName ?? t("reports.supplierLedger.unassigned")} ·{" "}
                            {t("reports.supplierLedger.ledgerLines", { count: e.lines.filter((l) => !l.isVoided).length })}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {!e.isPosted && (
                            <Badge variant="outline" className="font-normal text-amber-600">
                              {t("reports.supplierLedger.notPosted")}
                            </Badge>
                          )}
                          {e.lines.length > 0 && !e.balanced && (
                            <Badge variant="destructive" className="font-normal">
                              {t("reports.supplierLedger.posting.unbalanced", { count: 1 })}
                            </Badge>
                          )}
                          <span className="text-sm font-semibold tabular-nums">
                            {fmt(e.amount)}
                          </span>
                        </div>
                      </button>

                      {open && (
                        <div className="bg-muted/30 px-4 pb-4">
                          {e.lines.length === 0 ? (
                            <p className="py-3 text-sm text-muted-foreground">
                              {t("reports.supplierLedger.noLines")}
                            </p>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t("reports.supplierLedger.columns.date")}</TableHead>
                                  <TableHead>{t("reports.supplierLedger.columns.account")}</TableHead>
                                  <TableHead>{t("reports.supplierLedger.columns.narration")}</TableHead>
                                  <TableHead className="text-end">{t("reports.supplierLedger.columns.debit")}</TableHead>
                                  <TableHead className="text-end">{t("reports.supplierLedger.columns.credit")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {e.lines.map((l) => (
                                  <TableRow
                                    key={l.id}
                                    className={l.isVoided ? "opacity-50 line-through" : ""}
                                  >
                                    <TableCell className="text-sm tabular-nums">{l.date}</TableCell>
                                    <TableCell className="text-sm">
                                      <span className="font-medium tabular-nums">
                                        {l.accountCode}
                                      </span>{" "}
                                      · {l.accountName}
                                    </TableCell>
                                    <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                                      {l.description ?? "-"}
                                    </TableCell>
                                    <TableCell className="text-end tabular-nums">
                                      {l.debit > 0.005 ? fmt(l.debit) : "-"}
                                    </TableCell>
                                    <TableCell className="text-end tabular-nums">
                                      {l.credit > 0.005 ? fmt(l.credit) : "-"}
                                    </TableCell>
                                  </TableRow>
                                ))}
                                <TableRow className="border-t-2 bg-muted/50 hover:bg-muted/50">
                                  <TableCell colSpan={3} className="font-semibold">
                                    {t("reports.supplierLedger.entryTotal")}
                                  </TableCell>
                                  <TableCell className="text-end font-semibold tabular-nums">
                                    {fmt(e.totalDebit)}
                                  </TableCell>
                                  <TableCell className="text-end font-semibold tabular-nums">
                                    {fmt(e.totalCredit)}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <SupplierApAccountHistoryCard supplierId={supplierId || null} />
    </div>
  );
}
