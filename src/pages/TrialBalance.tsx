import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { Scale, Download, CheckCircle2, AlertTriangle, Info, Building2 } from "lucide-react";
import { FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { usePersistedBranchDateFilter } from "@/hooks/usePersistedBranchDateFilter";
import { useTranslation } from "react-i18next";
import {
  BranchDateRangeFilter,
  resolvePreset,
} from "@/components/filters/BranchDateRangeFilter";
import {
  useTrialBalance,
  UNASSIGNED_BRANCH_ID,
  type TrialBalanceRow,
} from "@/hooks/useTrialBalance";
import { useFiscalPeriodLocks } from "@/hooks/useFiscalPeriodLocks";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lock, Loader2 } from "lucide-react";
import type { AccountType } from "@/hooks/useChartOfAccounts";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { AccountDrilldownDialog } from "@/components/finance/AccountDrilldownDialog";
import { ImbalanceBreakdown } from "@/components/finance/ImbalanceBreakdown";
import { OpenDayEndAdjustmentsCard } from "@/components/finance/OpenDayEndAdjustmentsCard";


const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "cogs", "expense"];

export default function TrialBalance() {
  const { tenant, hasFeature, loading } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();
  const { t } = useTranslation();
  const TYPE_LABEL: Record<AccountType, string> = {
    asset: t("app.trialBalance.types.asset"),
    liability: t("app.trialBalance.types.liability"),
    equity: t("app.trialBalance.types.equity"),
    revenue: t("app.trialBalance.types.revenue"),
    cogs: t("app.trialBalance.types.cogs"),
    expense: t("app.trialBalance.types.expense"),
  };

  const {
    branchId,
    setBranchId,
    preset,
    setPreset,
    customRange,
    setCustomRange,
  } = usePersistedBranchDateFilter("trial-balance", tenant?.id, {
    branchId: pinnedBranchId ?? activeBranchId ?? "all",
    preset: "this-month",
  });

  const range = preset === "custom" ? customRange : resolvePreset(preset);
  const from = range?.from ?? null;
  const to = range?.to ?? null;

  const { rows, totals, branchIds, isLoading } = useTrialBalance({ from, to, branchId });

  const [drilldownRow, setDrilldownRow] = useState<TrialBalanceRow | null>(null);
  const [showBranchColumns, setShowBranchColumns] = useState(true);
  const [closeOpen, setCloseOpen] = useState(false);
  const { lockPeriod, isLocking, getLockForPeriod } = useFiscalPeriodLocks();

  const periodLock = from && to ? getLockForPeriod(from, to) : undefined;
  const isPeriodLocked = !!periodLock?.is_locked;

  const grouped = useMemo(() => {
    const map = new Map<AccountType, TrialBalanceRow[]>();
    for (const r of rows) {
      const arr = map.get(r.type) ?? [];
      arr.push(r);
      map.set(r.type, arr);
    }
    return map;
  }, [rows]);

  const periodLabel =
    from && to ? `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}` : "-";

  /** Render a signed balance on its natural side, e.g. "﷼ 1,200.00 Dr". */
  const balanceLabel = (row: TrialBalanceRow, value: number) => {
    if (Math.abs(value) < 0.005) return "-";
    const normalSide = row.side;
    const side = value > 0 ? normalSide : normalSide === "debit" ? "credit" : "debit";
    return `${fmt(Math.abs(value))} ${side === "debit" ? "Dr" : "Cr"}`;
  };

  const signedTotal = (rowsIn: TrialBalanceRow[], key: "openingBalance" | "closingBalance") => {
    const debit = rowsIn.reduce(
      (s, r) => s + (r.side === "debit" ? Math.max(r[key], 0) : Math.max(-r[key], 0)),
      0,
    );
    const credit = rowsIn.reduce(
      (s, r) => s + (r.side === "credit" ? Math.max(r[key], 0) : Math.max(-r[key], 0)),
      0,
    );
    return { debit, credit };
  };

  const { branches } = useBranch();
  const branchScopeLabel =
    !branchId || branchId === "all"
      ? "All branches"
      : branches.find((b) => b.id === branchId)?.name ?? branchId;

  const branchName = (id: string) =>
    id === UNASSIGNED_BRANCH_ID
      ? "Unassigned"
      : branches.find((b) => b.id === id)?.name ?? id.slice(0, 8);

  /** Branch columns are only meaningful when looking at more than one branch. */
  const branchColumns = useMemo(
    () =>
      showBranchColumns && (!branchId || branchId === "all") && branchIds.length > 1
        ? branchIds
        : [],
    [showBranchColumns, branchId, branchIds],
  );
  const colCount = 6 + branchColumns.length;

  const branchNet = (row: TrialBalanceRow, id: string) => row.branchBalances[id]?.net ?? 0;
  const branchSubtotal = (rowsIn: TrialBalanceRow[], id: string) => {
    const debit = rowsIn.reduce((s, r) => {
      const v = branchNet(r, id);
      return s + (r.side === "debit" ? Math.max(v, 0) : Math.max(-v, 0));
    }, 0);
    const credit = rowsIn.reduce((s, r) => {
      const v = branchNet(r, id);
      return s + (r.side === "credit" ? Math.max(v, 0) : Math.max(-v, 0));
    }, 0);
    return debit - credit;
  };

  const handleClosePeriod = async () => {
    if (!from || !to) return;
    await lockPeriod.mutateAsync({ periodStart: from, periodEnd: to });
    setCloseOpen(false);
  };

  const handleExportCsv = () => {
    const lines: string[] = [];
    lines.push(`Trial Balance,${tenant?.name ?? ""}`);
    lines.push(`Period,${periodLabel}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push("");
    const header = [
      "Account Code",
      "Account Name",
      "Account Type",
      "Opening Balance",
      "Opening Side",
      "Debit",
      "Credit",
      "Closing Balance",
      "Closing Side",
      ...branchColumns.map((id) => `${branchName(id)} (net)`),
    ];
    lines.push(header.join(","));
    for (const t of TYPE_ORDER) {
      const group = grouped.get(t) ?? [];
      for (const r of group) {
        const openSide =
          r.openingBalance >= 0 ? r.side : r.side === "debit" ? "credit" : "debit";
        const closeSide =
          r.closingBalance >= 0 ? r.side : r.side === "debit" ? "credit" : "debit";
        lines.push(
          [
            r.code,
            `"${r.name.replace(/"/g, '""')}"`,
            TYPE_LABEL[r.type],
            Math.abs(r.openingBalance).toFixed(2),
            openSide === "debit" ? "Dr" : "Cr",
            r.debitAmount.toFixed(2),
            r.creditAmount.toFixed(2),
            Math.abs(r.closingBalance).toFixed(2),
            closeSide === "debit" ? "Dr" : "Cr",
            ...branchColumns.map((id) => branchNet(r, id).toFixed(2)),
          ].join(","),
        );
      }
    }
    lines.push(
      [
        "",
        "TOTAL",
        "",
        `${totals.openingDebit.toFixed(2)} Dr / ${totals.openingCredit.toFixed(2)} Cr`,
        "",
        totals.debit.toFixed(2),
        totals.credit.toFixed(2),
        `${totals.closingDebit.toFixed(2)} Dr / ${totals.closingCredit.toFixed(2)} Cr`,
        "",
      ].join(","),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial-balance-${from ? format(from, "yyyy-MM-dd") : "all"}-to-${
      to ? format(to, "yyyy-MM-dd") : "all"
    }${branchId && branchId !== "all" ? `-${branchScopeLabel.replace(/\s+/g, "_")}` : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(t("app.trialBalance.csvExported"));
  };

  const handleExportPdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const tenantName = tenant?.name ?? "Trial Balance";

    doc.setFillColor(0, 168, 89);
    doc.rect(0, 0, pageWidth, 66, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Trial Balance", 40, 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(tenantName, 40, 44);
    doc.text(`${branchScopeLabel} - ${periodLabel}`, 40, 57);
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${format(new Date(), "MMM d, yyyy HH:mm")}`, pageWidth - 40, 86, {
      align: "right",
    });

    const body: Array<Array<string>> = [];
    for (const type of TYPE_ORDER) {
      const group = grouped.get(type);
      if (!group || group.length === 0) continue;
      body.push([{ content: TYPE_LABEL[type], colSpan: 6, styles: { fontStyle: "bold", fillColor: [240, 240, 240] } } as unknown as string]);
      let subD = 0;
      let subC = 0;
      for (const r of group) {
        subD += r.debitAmount;
        subC += r.creditAmount;
        const openSide = r.openingBalance >= 0 ? r.side : r.side === "debit" ? "credit" : "debit";
        const closeSide = r.closingBalance >= 0 ? r.side : r.side === "debit" ? "credit" : "debit";
        body.push([
          r.code,
          r.name,
          Math.abs(r.openingBalance) > 0.005
            ? `${Math.abs(r.openingBalance).toFixed(2)} ${openSide === "debit" ? "Dr" : "Cr"}`
            : "-",
          r.debitAmount > 0 ? r.debitAmount.toFixed(2) : "-",
          r.creditAmount > 0 ? r.creditAmount.toFixed(2) : "-",
          Math.abs(r.closingBalance) > 0.005
            ? `${Math.abs(r.closingBalance).toFixed(2)} ${closeSide === "debit" ? "Dr" : "Cr"}`
            : "-",
        ]);
      }
      const subOpen = signedTotal(group, "openingBalance");
      const subClose = signedTotal(group, "closingBalance");
      body.push([
        "",
        { content: `Subtotal ${TYPE_LABEL[type]}`, styles: { fontStyle: "bold", halign: "right" } } as unknown as string,
        { content: `${subOpen.debit.toFixed(2)} Dr / ${subOpen.credit.toFixed(2)} Cr`, styles: { fontStyle: "bold", halign: "right" } } as unknown as string,
        { content: subD.toFixed(2), styles: { fontStyle: "bold", halign: "right" } } as unknown as string,
        { content: subC.toFixed(2), styles: { fontStyle: "bold", halign: "right" } } as unknown as string,
        { content: `${subClose.debit.toFixed(2)} Dr / ${subClose.credit.toFixed(2)} Cr`, styles: { fontStyle: "bold", halign: "right" } } as unknown as string,
      ]);
    }
    body.push([
      "",
      { content: "TOTAL", styles: { fontStyle: "bold", fillColor: [220, 220, 220] } } as unknown as string,
      { content: `${totals.openingDebit.toFixed(2)} Dr / ${totals.openingCredit.toFixed(2)} Cr`, styles: { fontStyle: "bold", halign: "right", fillColor: [220, 220, 220] } } as unknown as string,
      { content: totals.debit.toFixed(2), styles: { fontStyle: "bold", halign: "right", fillColor: [220, 220, 220] } } as unknown as string,
      { content: totals.credit.toFixed(2), styles: { fontStyle: "bold", halign: "right", fillColor: [220, 220, 220] } } as unknown as string,
      { content: `${totals.closingDebit.toFixed(2)} Dr / ${totals.closingCredit.toFixed(2)} Cr`, styles: { fontStyle: "bold", halign: "right", fillColor: [220, 220, 220] } } as unknown as string,
    ]);

    autoTable(doc, {
      startY: 115,
      head: [["Code", "Account", "Opening", "Debit", "Credit", "Closing"]],
      body,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [0, 168, 89], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 55 },
        2: { halign: "right", cellWidth: 95 },
        3: { halign: "right", cellWidth: 75 },
        4: { halign: "right", cellWidth: 75 },
        5: { halign: "right", cellWidth: 95 },
      },
      margin: { left: 40, right: 40 },
    });

    const status = totals.balanced
      ? `Balanced · Debits ${totals.debit.toFixed(2)} = Credits ${totals.credit.toFixed(2)}`
      : `OUT OF BALANCE · Difference ${totals.diff.toFixed(2)}`;
    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 115;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(status, 40, finalY + 24);

    // Footnote explaining the balance status and how the difference is calculated
    const footnoteY = finalY + 44;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("About this report", 40, footnoteY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const footnoteLines = [
      `This Trial Balance aggregates every posted journal entry between ${periodLabel} across all branches`,
      `(the general ledger is maintained at the tenant level). For each active account, the report sums all`,
      `debit postings into the Debit column and all credit postings into the Credit column for the period.`,
      `Subtotals are shown per account type, and the TOTAL row sums every account.`,
      ``,
      `Balance status: under double-entry accounting, Total Debits must equal Total Credits. The Difference`,
      `is calculated as |Total Debits − Total Credits|. A difference of 0.00 means the ledger is balanced for`,
      `the selected period. Any non-zero difference indicates one or more unbalanced journal batches`,
      `review the Imbalance Breakdown on the Trial Balance page to identify the specific entries.`,
    ];
    let lineY = footnoteY + 12;
    for (const line of footnoteLines) {
      doc.text(line, 40, lineY);
      lineY += 10;
    }

    const pages = doc.getNumberOfPages();
    const pageHeight = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pages; i += 1) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(110, 118, 128);
      doc.text(`${tenantName} - Trial Balance`, 40, pageHeight - 20);
      doc.text(`Page ${i} / ${pages}`, pageWidth - 40, pageHeight - 20, { align: "right" });
    }

    const fileName = `trial-balance-${from ? format(from, "yyyy-MM-dd") : "all"}-to-${
      to ? format(to, "yyyy-MM-dd") : "all"
    }.pdf`;
    doc.save(fileName);

    toast.success(t("app.trialBalance.pdfExported"));
  };

  if (!loading && !hasFeature("accounting")) {
    return (
      <>
        <LockedFeatureScreen
          featureName={t("app.trialBalance.lockedName")}
          description={t("app.trialBalance.lockedDesc")}
          featureKey="accounting"
        />
      </>
    );
  }

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
              <Scale className="h-7 w-7 text-primary" />
              {t("app.trialBalance.title")}
              <Badge variant="secondary" className="ml-1 gap-1 font-normal">
                <Building2 className="h-3 w-3" />
                {t("app.trialBalance.tenantWide")}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("app.trialBalance.period", { period: periodLabel })}
            </p>
          </div>
          <div className="data-panel flex flex-col items-stretch gap-2 p-2 sm:flex-row sm:flex-wrap sm:items-center md:justify-end">
            <BranchDateRangeFilter
              branchId={branchId}
              onBranchChange={setBranchId}
              preset={preset}
              onPresetChange={setPreset}
              dateRange={customRange}
              onDateRangeChange={setCustomRange}
            />
            <Button
              variant={isPeriodLocked ? "secondary" : "default"}
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setCloseOpen(true)}
              disabled={isLoading || !from || !to || isPeriodLocked || isLocking}
            >
              {isLocking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
               {isPeriodLocked ? t("app.trialBalance.periodClosed") : t("app.trialBalance.closePeriod")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={handleExportCsv}
              disabled={isLoading || rows.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              {t("app.trialBalance.exportCsv")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={handleExportPdf}
              disabled={isLoading || rows.length === 0}
            >
              <FileText className="h-3.5 w-3.5" />
              {t("app.trialBalance.exportPdf")}
            </Button>
          </div>
        </header>

        {branchId && branchId !== "all" && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>{t("app.trialBalance.branchAlertTitle")}</AlertTitle>
            <AlertDescription>
              {t("app.trialBalance.branchAlertDesc")}
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && (
          <Alert variant={totals.balanced ? "default" : "destructive"}>
            {totals.balanced ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            <AlertTitle>
              {totals.balanced ? t("app.trialBalance.balanced") : t("app.trialBalance.unbalanced")}
            </AlertTitle>
            <AlertDescription>
              {t("app.trialBalance.totals", { debit: fmt(totals.debit), credit: fmt(totals.credit) })}
              {!totals.balanced && (
                <>
                  {" "}
                  · {t("app.trialBalance.difference")}{" "}
                  <span className="font-semibold tabular-nums">{fmt(totals.diff)}</span>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !totals.balanced && (
          <ImbalanceBreakdown from={from} to={to} />
        )}

        <OpenDayEndAdjustmentsCard from={from} to={to} branchId={branchId} />


        <Card className="overflow-hidden">
          <CardHeader className="pb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base font-medium">{t("app.trialBalance.accountsTitle")}</CardTitle>
              <CardDescription>{t("app.trialBalance.accountsDesc")}</CardDescription>
            </div>
            {(!branchId || branchId === "all") && branchIds.length > 1 && (
              <div className="flex items-center gap-2">
                <Switch
                  id="tb-branch-cols"
                  checked={showBranchColumns}
                  onCheckedChange={setShowBranchColumns}
                />
                <Label htmlFor="tb-branch-cols" className="text-xs text-muted-foreground">
                  {t("app.trialBalance.branchColumns")}
                </Label>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                {t("app.trialBalance.noActivity")}
              </div>
            ) : (
              <ScrollArea className="max-h-[70vh]">
                <Table className="min-w-[880px]">
                  <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_hsl(var(--border))]">
                    <TableRow>
                      <TableHead className="w-[110px] border-e border-border/50">{t("app.trialBalance.col.code")}</TableHead>
                      <TableHead className="min-w-[220px] border-e border-border/50">{t("app.trialBalance.col.account")}</TableHead>
                      <TableHead className="text-end">
                        {t("app.trialBalance.col.opening", { defaultValue: "Opening" })}
                      </TableHead>
                      <TableHead className="text-end">{t("app.trialBalance.col.debit")}</TableHead>
                      <TableHead className="text-end">{t("app.trialBalance.col.credit")}</TableHead>
                      <TableHead className="text-end">
                        {t("app.trialBalance.col.closing", { defaultValue: "Closing" })}
                      </TableHead>
                      {branchColumns.map((id) => (
                        <TableHead key={id} className="text-end whitespace-nowrap">
                          {branchName(id)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {TYPE_ORDER.map((type) => {
                      const group = grouped.get(type);
                      if (!group || group.length === 0) return null;
                      const subDebit = group.reduce((s, r) => s + r.debitAmount, 0);
                      const subCredit = group.reduce((s, r) => s + r.creditAmount, 0);
                      const subOpen = signedTotal(group, "openingBalance");
                      const subClose = signedTotal(group, "closingBalance");
                      return (
                        <Fragment key={`g-${type}`}>
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={colCount} className="font-semibold text-xs uppercase tracking-wide">
                              {TYPE_LABEL[type]}
                            </TableCell>
                          </TableRow>
                          {group.map((r) => (
                            <TableRow
                              key={r.accountId}
                              role={r.isDerived ? undefined : "button"}
                              tabIndex={r.isDerived ? undefined : 0}
                              className={
                                r.isDerived
                                  ? "bg-muted/20"
                                  : "cursor-pointer hover:bg-muted/50"
                              }
                              onClick={() => !r.isDerived && setDrilldownRow(r)}
                              onKeyDown={(e) => {
                                if (!r.isDerived && (e.key === "Enter" || e.key === " ")) {
                                  e.preventDefault();
                                  setDrilldownRow(r);
                                }
                              }}
                            >
                              <TableCell className="border-e border-border/50 font-mono text-xs">{r.code}</TableCell>
                              <TableCell className="border-e border-border/50">
                                <div className="flex items-center gap-2">
                                  <span className={r.isDerived ? "" : "underline-offset-2 hover:underline"}>
                                    {r.name}
                                  </span>
                                  {r.isDerived && (
                                    <Badge variant="secondary" className="text-[10px]">
                                      {t("app.trialBalance.computed", { defaultValue: "Computed" })}
                                    </Badge>
                                  )}
                                  {r.netBalance < 0 && (
                                    <Badge variant="outline" className="text-[10px]">
                                      {t("app.trialBalance.abnormal")}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-end tabular-nums">
                                {balanceLabel(r, r.openingBalance)}
                              </TableCell>
                              <TableCell className="text-end tabular-nums">
                                {r.debitAmount > 0 ? fmt(r.debitAmount) : "-"}
                              </TableCell>
                              <TableCell className="text-end tabular-nums">
                                {r.creditAmount > 0 ? fmt(r.creditAmount) : "-"}
                              </TableCell>
                              <TableCell className="border-s border-border/50 bg-muted/15 text-end tabular-nums font-semibold">
                                {balanceLabel(r, r.closingBalance)}
                              </TableCell>
                              {branchColumns.map((id) => (
                                <TableCell key={id} className="text-end tabular-nums text-xs">
                                  {balanceLabel(r, branchNet(r, id))}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2">
                            <TableCell />
                            <TableCell className="text-end text-xs text-muted-foreground">
                              {t("app.trialBalance.subtotal", { type: TYPE_LABEL[type] })}
                            </TableCell>
                            <TableCell className="text-end tabular-nums text-xs">
                              {fmt(subOpen.debit)} Dr / {fmt(subOpen.credit)} Cr
                            </TableCell>
                            <TableCell className="text-end tabular-nums font-medium">
                              {fmt(subDebit)}
                            </TableCell>
                            <TableCell className="text-end tabular-nums font-medium">
                              {fmt(subCredit)}
                            </TableCell>
                            <TableCell className="text-end tabular-nums text-xs">
                              {fmt(subClose.debit)} Dr / {fmt(subClose.credit)} Cr
                            </TableCell>
                            {branchColumns.map((id) => {
                              const v = branchSubtotal(group, id);
                              return (
                                <TableCell key={id} className="text-end tabular-nums text-xs font-medium">
                                  {Math.abs(v) < 0.005
                                    ? "-"
                                    : `${fmt(Math.abs(v))} ${v > 0 ? "Dr" : "Cr"}`}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        </Fragment>
                      );
                    })}
                    <TableRow className="bg-muted/60 hover:bg-muted/60 border-t-4">
                      <TableCell />
                      <TableCell className="font-semibold">{t("app.trialBalance.total")}</TableCell>
                      <TableCell className="text-end tabular-nums text-xs font-semibold">
                        {fmt(totals.openingDebit)} Dr / {fmt(totals.openingCredit)} Cr
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-semibold">
                        {fmt(totals.debit)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-semibold">
                        {fmt(totals.credit)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-xs font-semibold">
                        {fmt(totals.closingDebit)} Dr / {fmt(totals.closingCredit)} Cr
                      </TableCell>
                      {branchColumns.map((id) => {
                        const v = branchSubtotal(rows, id);
                        return (
                          <TableCell key={id} className="text-end tabular-nums text-xs font-semibold">
                            {Math.abs(v) < 0.005
                              ? "-"
                              : `${fmt(Math.abs(v))} ${v > 0 ? "Dr" : "Cr"}`}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.trialBalance.closeDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {periodLabel} will be locked. No further journal entries, expenses or sales can be
              posted into these dates until the period is unlocked.
              {!totals.balanced && (
                <span className="mt-2 block font-medium text-destructive">
                  The trial balance is currently out of balance by {fmt(totals.diff)}. Closing now
                  will freeze that difference.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("app.trialBalance.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleClosePeriod} disabled={isLocking}>
              Close period
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AccountDrilldownDialog
        row={drilldownRow}
        from={from}
        to={to}
        open={!!drilldownRow}
        onOpenChange={(open) => !open && setDrilldownRow(null)}
      />
    </>
  );
}