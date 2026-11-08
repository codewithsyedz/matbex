import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Download, Layers, Wallet, AlertTriangle } from "lucide-react";
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
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { AGING_BUCKETS, useApAging, type AgingBucket } from "@/hooks/useApAging";
import { ExpenseSettlementTimeline } from "@/components/expenses/ExpenseSettlementTimeline";
import { useTranslation } from "react-i18next";
import { ar, enUS } from "date-fns/locale";

const bucketTone: Record<AgingBucket, string> = {
  current: "text-muted-foreground",
  d1_30: "text-foreground",
  d31_60: "text-warning",
  d61_90: "text-warning",
  d90_plus: "text-destructive",
};

export default function ApAging() {
  const { tenant, hasFeature, loading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("ar") ? ar : enUS;

  const [asOf, setAsOf] = useState<Date>(new Date());
  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [supplierId, setSupplierId] = useState<string>("all");
  const [timeline, setTimeline] = useState<{ id: string; description: string } | null>(null);

  const {
    rows,
    suppliers,
    bucketTotals,
    byBranch,
    bySupplier,
    totalOpen,
    totalOverdue,
    isLoading,
  } = useApAging({ asOf, branchId, supplierId });

  const branchScopeLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? t("reports.apAging.allBranches")
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );

  const supplierScopeLabel = useMemo(
    () =>
      !supplierId || supplierId === "all"
        ? t("reports.apAging.allSuppliers")
        : suppliers.find((s) => s.id === supplierId)?.name ?? supplierId,
    [supplierId, suppliers],
  );

  const handleExportCsv = () => {
    const lines: string[] = [];
    lines.push(`{t("reports.apAging.title")},${tenant?.name ?? ""}`);
    lines.push(`As of,${format(asOf, "yyyy-MM-dd")}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push(`Supplier,${supplierScopeLabel}`);
    lines.push("");
    lines.push(
      [
        "Branch",
        "Supplier",
        "AP Account",
        "Invoice",
        "Description",
        "Document Date",
        "Due Date",
        "Days Overdue",
        "Bucket",
        "Billed",
        "Settled",
        "Open Balance",
      ].join(","),
    );
    for (const r of rows) {
      lines.push(
        [
          `"${(r.branchName ?? t("reports.apAging.unassigned")).replace(/"/g, '""')}"`,
          `"${(r.supplierName ?? "").replace(/"/g, '""')}"`,
          `"${[r.apAccountCode, r.apAccountName].filter(Boolean).join(" · ").replace(/"/g, '""')}"`,
          `"${(r.invoiceNumber ?? "").replace(/"/g, '""')}"`,
          `"${r.description.replace(/"/g, '""')}"`,
          r.documentDate ?? "",
          r.dueDate ?? "",
          String(r.daysOverdue),
          AGING_BUCKETS.find((b) => b.key === r.bucket)?.label ?? r.bucket,
          r.billed.toFixed(2),
          r.settled.toFixed(2),
          r.open.toFixed(2),
        ].join(","),
      );
    }
    lines.push(
      ["", "", "", "", "TOTAL", "", "", "", "", "", "", totalOpen.toFixed(2)].join(","),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ap-aging-${format(asOf, "yyyy-MM-dd")}${
      branchId !== "all" ? `-${branchScopeLabel.replace(/\s+/g, "_")}` : ""
    }.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(t("reports.apAging.exported"));
  };

  if (!loading && !hasFeature("accounting")) {
    return (
      <LockedFeatureScreen
        featureName={t("reports.apAging.title")}
        description={t("reports.apAging.bySupplierDescription")}
        featureKey="accounting"
      />
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Layers className="h-7 w-7 text-primary" />
            {t("reports.apAging.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Open balances rolled forward from every posting and settlement entry as of{" "}
            {format(asOf, "MMM d, yyyy")} · {branchScopeLabel} · {supplierScopeLabel}
          </p>
        </div>

        <div className="data-panel flex flex-col items-stretch gap-2 p-2 sm:flex-row sm:flex-wrap sm:items-center md:justify-end">
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder={t("reports.apAging.supplier")} />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">{t("reports.apAging.allSuppliers")}</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue placeholder={t("reports.apAging.branch")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("reports.apAging.allBranches")}</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" />
                {t("reports.apAging.asOf", { date: format(asOf, "PP", { locale: dateLocale }) })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={asOf}
                onSelect={(d) => d && setAsOf(d)}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleExportCsv}
            disabled={isLoading || rows.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            {t("reports.apAging.export")}
          </Button>
        </div>
      </header>

      {/* Bucket summary */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" /> Total open
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totalOpen)}</p>
          </CardContent>
        </Card>
        {AGING_BUCKETS.map((b) => (
          <Card key={b.key}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{t(`reports.apAging.buckets.${b.key}`, { defaultValue: b.label })}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${bucketTone[b.key]}`}>
                {fmt(bucketTotals[b.key])}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalOverdue > 0.005 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span className="font-medium text-foreground">{fmt(totalOverdue)}</span> is past due across{" "}
          {rows.filter((r) => r.daysOverdue > 0).length} payables.
        </p>
      )}

      {/* Per-branch matrix */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">{t("reports.apAging.bySupplier")}</CardTitle>
          <CardDescription>
            {t("reports.apAging.bySupplierDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : bySupplier.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {t("reports.apAging.noSupplier")}
            </div>
          ) : (
            <Table className="min-w-[760px]">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead>{t("reports.apAging.columns.supplier")}</TableHead>
                  <TableHead>{t("reports.apAging.columns.apHead")}</TableHead>
                  {AGING_BUCKETS.map((b) => (
                    <TableHead key={b.key} className="text-end">
                      {t(`reports.apAging.buckets.${b.key}`, { defaultValue: b.label })}
                    </TableHead>
                  ))}
                  <TableHead className="border-s border-border/50 bg-muted/70 text-end">{t("reports.apAging.columns.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySupplier.map((row) => (
                  <TableRow
                    key={row.supplierId ?? "unassigned"}
                    className={row.supplierId ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => row.supplierId && setSupplierId(row.supplierId)}
                  >
                    <TableCell className="font-medium">{row.supplierName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.apAccountCode ?? "—"}
                    </TableCell>
                    {AGING_BUCKETS.map((b) => (
                      <TableCell key={b.key} className="text-end tabular-nums">
                        {row.buckets[b.key] > 0.005 ? fmt(row.buckets[b.key]) : "-"}
                      </TableCell>
                    ))}
                    <TableCell className="border-s border-border/50 bg-muted/20 text-end font-semibold tabular-nums">
                      {fmt(row.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Per-branch matrix */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">{t("reports.apAging.byBranch")}</CardTitle>
          <CardDescription>{t("reports.apAging.byBranchDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : byBranch.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {t("reports.apAging.noBranch")}
            </div>
          ) : (
            <Table className="min-w-[680px]">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead>{t("reports.apAging.columns.branch")}</TableHead>
                  {AGING_BUCKETS.map((b) => (
                    <TableHead key={b.key} className="text-end">
                      {t(`reports.apAging.buckets.${b.key}`, { defaultValue: b.label })}
                    </TableHead>
                  ))}
                  <TableHead className="border-s border-border/50 bg-muted/70 text-end">{t("reports.apAging.columns.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byBranch.map((row) => (
                  <TableRow key={row.branchId ?? "unassigned"}>
                    <TableCell className="font-medium">{row.branchName}</TableCell>
                    {AGING_BUCKETS.map((b) => (
                      <TableCell key={b.key} className="text-end tabular-nums">
                        {row.buckets[b.key] > 0.005 ? fmt(row.buckets[b.key]) : "-"}
                      </TableCell>
                    ))}
                    <TableCell className="border-s border-border/50 bg-muted/20 text-end font-semibold tabular-nums">
                      {fmt(row.total)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 bg-muted/50 hover:bg-muted/50">
                  <TableCell className="font-semibold">{t("reports.apAging.columns.total")}</TableCell>
                  {AGING_BUCKETS.map((b) => (
                    <TableCell key={b.key} className="text-end font-semibold tabular-nums">
                      {fmt(bucketTotals[b.key])}
                    </TableCell>
                  ))}
                  <TableCell className="text-end font-semibold tabular-nums">
                    {fmt(totalOpen)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">{t("reports.apAging.openPayables")}</CardTitle>
          <CardDescription>
            {t("reports.apAging.openDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {t("reports.apAging.nothing")}
            </div>
          ) : (
            <ScrollArea className="max-h-[65vh]">
              <Table className="min-w-[980px]">
                <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead>{t("reports.apAging.columns.supplierDescription")}</TableHead>
                    <TableHead>{t("reports.apAging.columns.apHead")}</TableHead>
                    <TableHead>{t("reports.apAging.columns.branch")}</TableHead>
                    <TableHead>{t("reports.apAging.columns.due")}</TableHead>
                    <TableHead className="text-end">{t("reports.apAging.columns.age")}</TableHead>
                    <TableHead className="text-end">{t("reports.apAging.columns.billed")}</TableHead>
                    <TableHead className="text-end">{t("reports.apAging.columns.settled")}</TableHead>
                    <TableHead className="border-s border-border/50 bg-muted/70 text-end">{t("reports.apAging.columns.open")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.key}
                      className={r.expenseId ? "cursor-pointer hover:bg-muted/50" : ""}
                      onClick={() =>
                        r.expenseId && setTimeline({ id: r.expenseId, description: r.description })
                      }
                    >
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {r.supplierName ?? r.description}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {r.invoiceNumber ? `${r.invoiceNumber} · ` : ""}
                            {r.supplierName ? r.description : r.documentDate ?? ""}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.apAccountCode ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{r.branchName ?? t("reports.apAging.unassigned")}</TableCell>
                      <TableCell className="text-sm tabular-nums">{r.dueDate ?? "-"}</TableCell>
                      <TableCell className="text-end">
                        <Badge
                          variant={r.daysOverdue > 60 ? "destructive" : "outline"}
                          className="font-normal"
                        >
                          {r.daysOverdue > 0 ? t("reports.apAging.daysOverdue", { count: r.daysOverdue }) : t("reports.apAging.notDue")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(r.billed)}</TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">
                        {r.settled > 0.005 ? fmt(r.settled) : "-"}
                      </TableCell>
                      <TableCell className={`border-s border-border/50 bg-muted/20 text-end font-semibold tabular-nums ${bucketTone[r.bucket]}`}>
                        {fmt(r.open)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 bg-muted/50 hover:bg-muted/50">
                    <TableCell colSpan={7} className="font-semibold">
                      Total open payables
                    </TableCell>
                    <TableCell className="text-end font-semibold tabular-nums">
                      {fmt(totalOpen)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <ExpenseSettlementTimeline
        expenseId={timeline?.id ?? null}
        expenseDescription={timeline?.description}
        open={!!timeline}
        onOpenChange={(o) => !o && setTimeline(null)}
      />
    </div>
  );
}
