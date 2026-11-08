import { useMemo, useState } from "react";
import { format, subMonths, addMonths, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Download, FileText, TrendingDown, Building2, Layers, Link2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { DepreciationTrendCharts } from "@/components/reports/DepreciationTrendCharts";
import { DepreciationReconciliation } from "@/components/reports/DepreciationReconciliation";
import { useDepreciationReconciliation } from "@/hooks/useDepreciationReconciliation";
import { exportDepreciationPdf } from "@/lib/depreciationPdf";
import { useShareableReportLink } from "@/hooks/useShareableReportLink";
import { ShareReportLinkDialog } from "@/components/reports/ShareReportLinkDialog";
import {
  useDepreciationReport,
  type DepreciationGroup,
  type DepreciationTotals,
} from "@/hooks/useDepreciationReport";

const csvCell = (v: string | number | null | undefined) =>
  typeof v === "number" ? v.toFixed(2) : `"${String(v ?? "").replace(/"/g, '""')}"`;

type CompareMode = "none" | "prior_month" | "prior_year";

const COMPARE_LABEL: Record<CompareMode, string> = {
  none: "No comparison",
  prior_month: "vs prior month",
  prior_year: "vs same month last year",
};

const variance = (current: number, prior: number) => {
  const delta = Math.round((current - prior) * 100) / 100;
  const pct = prior === 0 ? null : Math.round((delta / Math.abs(prior)) * 1000) / 10;
  return { delta, pct };
};

/** Right-aligned variance cell: absolute delta with percentage underneath. */
function VarianceCell({
  current,
  prior,
  fmt,
  /** For NBV / cost a fall is neutral-negative; for charge a rise is the notable signal. */
  invert = false,
}: {
  current: number;
  prior: number;
  fmt: (n: number) => string;
  invert?: boolean;
}) {
  const { delta, pct } = variance(current, prior);
  const positive = invert ? delta < 0 : delta > 0;
  const tone =
    Math.abs(delta) < 0.005
      ? "text-muted-foreground"
      : positive
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive";
  return (
    <TableCell className={`text-right tabular-nums ${tone}`}>
      <div className="whitespace-nowrap">
        {delta > 0 ? "+" : delta < 0 ? "−" : ""}
        {fmt(Math.abs(delta))}
      </div>
      <div className="text-xs font-light opacity-80">
        {pct === null ? "new" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
      </div>
    </TableCell>
  );
}

export default function DepreciationReport() {
  const { hasFeature, loading, user, profile, role, restaurant } = useAuth() as any;
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt, displayCurrency } = useCurrency();

  const [periodMonth, setPeriodMonth] = useState<Date>(startOfMonth(new Date()));
  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [classId, setClassId] = useState<string>("all");
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { link, createLink, resignLink, isSharing } = useShareableReportLink();

  const comparePeriodMonth = useMemo(() => {
    if (compareMode === "prior_month") return startOfMonth(subMonths(periodMonth, 1));
    if (compareMode === "prior_year") return startOfMonth(subMonths(periodMonth, 12));
    return periodMonth;
  }, [compareMode, periodMonth]);
  const comparing = compareMode !== "none";

  const {
    restaurantName,
    rows,
    byBranch,
    byClass,
    byBranchClass,
    totals,
    classOptions,
    trend,
    isLoading,
    period,
    periodEndKey,
  } = useDepreciationReport({ periodMonth, branchId, classId });

  const prior = useDepreciationReport({
    periodMonth: comparePeriodMonth,
    branchId,
    classId,
  });

  const compareLabel = format(comparePeriodMonth, "MMMM yyyy");

  /** key → prior-period group, for the grouped tables. */
  const priorGroups = useMemo(() => {
    const build = (groups: DepreciationGroup[]) =>
      new Map(groups.map((g) => [g.key, g]));
    return {
      branch: build(prior.byBranch),
      class: build(prior.byClass),
      matrix: build(prior.byBranchClass),
    };
  }, [prior.byBranch, prior.byClass, prior.byBranchClass]);

  const priorRowById = useMemo(
    () => new Map(prior.rows.map((r) => [r.assetId, r])),
    [prior.rows],
  );

  const branchScopeLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? "All branches"
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );
  const periodLabel = format(periodMonth, "MMMM yyyy");
  const classScopeLabel = useMemo(
    () =>
      !classId || classId === "all"
        ? "All asset classes"
        : classOptions.find((c) => c.id === classId)?.name ?? "Selected class",
    [classId, classOptions],
  );

  const reconciliation = useDepreciationReconciliation({
    period,
    periodEndKey,
    branchId,
    registerPeriodExpense: totals.periodExpense,
    registerAccumulated: totals.closingAccumulated,
  });

  const handleExport = () => {
    const lines: string[] = [];
    lines.push(`Asset Depreciation Report,${csvCell(restaurantName)}`);
    lines.push(`Period,${csvCell(periodLabel)}`);
    lines.push(`Branch,${csvCell(branchScopeLabel)}`);
    if (comparing) lines.push(`Comparison period,${csvCell(compareLabel)}`);
    lines.push("");
    lines.push("SUMMARY BY BRANCH AND ASSET CLASS");
    lines.push(
      [
        "Restaurant",
        "Branch",
        "Asset Class",
        "Assets",
        "Cost",
        "Opening Accum. Depreciation",
        "Period Depreciation",
        "Closing Accum. Depreciation",
        "Net Book Value",
        ...(comparing
          ? [
              `Period Depreciation (${compareLabel})`,
              "Variance Depreciation",
              `Net Book Value (${compareLabel})`,
              "Variance Net Book Value",
            ]
          : []),
      ].join(","),
    );
    for (const g of byBranchClass) {
      const p = priorGroups.matrix.get(g.key);
      lines.push(
        [
          csvCell(restaurantName),
          csvCell(g.sublabel ?? ""),
          csvCell(g.label),
          g.assetCount,
          g.cost.toFixed(2),
          g.openingAccumulated.toFixed(2),
          g.periodExpense.toFixed(2),
          g.closingAccumulated.toFixed(2),
          g.netBookValue.toFixed(2),
          ...(comparing
            ? [
                (p?.periodExpense ?? 0).toFixed(2),
                (g.periodExpense - (p?.periodExpense ?? 0)).toFixed(2),
                (p?.netBookValue ?? 0).toFixed(2),
                (g.netBookValue - (p?.netBookValue ?? 0)).toFixed(2),
              ]
            : []),
        ].join(","),
      );
    }
    lines.push(
      [
        csvCell(restaurantName),
        csvCell("TOTAL"),
        "",
        totals.assetCount,
        totals.cost.toFixed(2),
        totals.openingAccumulated.toFixed(2),
        totals.periodExpense.toFixed(2),
        totals.closingAccumulated.toFixed(2),
        totals.netBookValue.toFixed(2),
        ...(comparing
          ? [
              prior.totals.periodExpense.toFixed(2),
              (totals.periodExpense - prior.totals.periodExpense).toFixed(2),
              prior.totals.netBookValue.toFixed(2),
              (totals.netBookValue - prior.totals.netBookValue).toFixed(2),
            ]
          : []),
      ].join(","),
    );
    lines.push("");
    lines.push("ASSET DETAIL");
    lines.push(
      [
        "Restaurant",
        "Branch",
        "Asset Class",
        "Asset Tag",
        "Asset",
        "In Service",
        "Method",
        "Useful Life (months)",
        "Status",
        "Cost",
        "Opening Accum. Depreciation",
        "Period Depreciation",
        "Closing Accum. Depreciation",
        "Net Book Value",
        ...(comparing
          ? [
              `Period Depreciation (${compareLabel})`,
              `Net Book Value (${compareLabel})`,
              "Variance Net Book Value",
            ]
          : []),
      ].join(","),
    );
    for (const r of rows) {
      const p = priorRowById.get(r.assetId);
      lines.push(
        [
          csvCell(restaurantName),
          csvCell(r.branchName),
          csvCell(r.className),
          csvCell(r.assetTag ?? ""),
          csvCell(r.name),
          csvCell(r.inServiceDate),
          csvCell(r.method === "reducing_balance" ? "Reducing balance" : "Straight line"),
          r.usefulLifeMonths,
          csvCell(r.status),
          r.cost.toFixed(2),
          r.openingAccumulated.toFixed(2),
          r.periodExpense.toFixed(2),
          r.closingAccumulated.toFixed(2),
          r.netBookValue.toFixed(2),
          ...(comparing
            ? [
                (p?.periodExpense ?? 0).toFixed(2),
                (p?.netBookValue ?? 0).toFixed(2),
                (r.netBookValue - (p?.netBookValue ?? 0)).toFixed(2),
              ]
            : []),
        ].join(","),
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `depreciation-${format(periodMonth, "yyyy-MM")}${
      branchId !== "all" ? `-${branchScopeLabel.replace(/\s+/g, "_")}` : ""
    }.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Depreciation report exported");
  };

  const pdfFileName = `depreciation-${format(periodMonth, "yyyy-MM")}${
    branchId !== "all" ? `-${branchScopeLabel.replace(/\s+/g, "_")}` : ""
  }.pdf`;

  const buildPdfArgs = (output: "save" | "blob") =>
    ({
        restaurantName,
        periodLabel,
        branchLabel: branchScopeLabel,
        classLabel: classScopeLabel,
        compareLabel: comparing ? compareLabel : null,
        currencyLabel: displayCurrency,
        totals,
        priorTotals: comparing ? prior.totals : null,
        byBranchClass,
        byClass,
        priorMatrix: priorGroups.matrix,
        priorClass: priorGroups.class,
        rows,
        priorRowById,
        reconciliation: reconciliation.isLoading ? null : reconciliation,
        auditStamp: {
          exportedBy:
            (profile as any)?.full_name ||
            (user as any)?.user_metadata?.full_name ||
            (user as any)?.email ||
            "Unknown user",
          exportedByEmail: (user as any)?.email ?? null,
          role: (role as any) ?? null,
          reference: `depreciation-${format(periodMonth, "yyyy-MM")}`,
          filters: [
            { label: "Restaurant", value: restaurantName },
            { label: "Period", value: periodLabel },
            { label: "Branch", value: branchScopeLabel },
            { label: "Asset class", value: classScopeLabel },
            { label: "Comparison", value: comparing ? compareLabel : "None" },
            { label: "Currency", value: displayCurrency },
            { label: "Assets included", value: String(rows.length) },
          ],
        },
      fileName: pdfFileName,
      output,
    }) as const;

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      await exportDepreciationPdf(buildPdfArgs("save") as any);
      toast.success("PDF exported");
    } catch (e) {
      console.error(e);
      toast.error("Could not generate the PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  const handleShareLink = async () => {
    if (!restaurant?.id) {
      toast.error("No restaurant selected");
      return;
    }
    setSharingPdf(true);
    try {
      const blob = (await exportDepreciationPdf(buildPdfArgs("blob") as any)) as Blob;
      await createLink({
        restaurantId: restaurant.id,
        folder: "depreciation",
        fileName: pdfFileName,
        blob,
        expiresInSeconds: 604800,
      });
      setShareOpen(true);
      toast.success("Shareable link ready");
    } catch (e) {
      console.error(e);
      toast.error("Could not create the shareable link");
    } finally {
      setSharingPdf(false);
    }
  };

  const handleChangeExpiry = async (seconds: number) => {
    if (!link) return;
    try {
      await resignLink(link.path, seconds);
      toast.success("Link validity updated");
    } catch (e) {
      console.error(e);
      toast.error("Could not update the link");
    }
  };

  if (!loading && !hasFeature("accounting")) {
    return (
      <LockedFeatureScreen
        featureName="Asset Depreciation Report"
        description="Cost, accumulated depreciation and net book value by branch and asset class."
        featureKey="accounting"
      />
    );
  }

  const summaryCards = [
    {
      label: "Gross cost",
      value: totals.cost,
      priorValue: prior.totals.cost,
      hint: `${totals.assetCount} assets on register`,
    },
    {
      label: "Accumulated depreciation",
      value: totals.closingAccumulated,
      priorValue: prior.totals.closingAccumulated,
      hint: `Opening ${fmt(totals.openingAccumulated)}`,
    },
    {
      label: `Depreciation · ${format(periodMonth, "MMM yyyy")}`,
      value: totals.periodExpense,
      priorValue: prior.totals.periodExpense,
      hint: "Charged to depreciation expense",
    },
    {
      label: "Net book value",
      value: totals.netBookValue,
      priorValue: prior.totals.netBookValue,
      hint: "Cost − accumulated depreciation",
    },
  ];

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between min-h-[56px]">
          <div className="min-w-0 min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <TrendingDown className="h-7 w-7 text-primary" />
            Asset Depreciation Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {restaurantName ? `${restaurantName} · ` : ""}
            {periodLabel} · {branchScopeLabel} — cost, accumulated depreciation, net book value and
            the charge posted for the period.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-1 rounded-md border px-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Previous month"
              onClick={() => setPeriodMonth((m) => startOfMonth(subMonths(m, 1)))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[110px] text-center text-sm font-medium">
              {format(periodMonth, "MMM yyyy")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Next month"
              onClick={() => setPeriodMonth((m) => startOfMonth(addMonths(m, 1)))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue placeholder="Branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue placeholder="Asset class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All asset classes</SelectItem>
              {classOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={compareMode} onValueChange={(v) => setCompareMode(v as CompareMode)}>
            <SelectTrigger className="h-9 w-[210px]">
              <SelectValue placeholder="Comparison" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{COMPARE_LABEL.none}</SelectItem>
              <SelectItem value="prior_month">{COMPARE_LABEL.prior_month}</SelectItem>
              <SelectItem value="prior_year">{COMPARE_LABEL.prior_year}</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>

          <Button onClick={handleExportPdf} disabled={rows.length === 0 || exportingPdf}>
            <FileText className="mr-2 h-4 w-4" />
            {exportingPdf ? "Preparing…" : "Export PDF"}
          </Button>

          <Button
            variant="outline"
            onClick={handleShareLink}
            disabled={rows.length === 0 || sharingPdf}
          >
            <Link2 className="mr-2 h-4 w-4" />
            {sharingPdf ? "Preparing…" : "Share link"}
          </Button>
        </div>
      </header>

      <ShareReportLinkDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        link={link}
        busy={isSharing}
        documentTitle={`Asset Depreciation Report — ${periodLabel} — ${branchScopeLabel}`}
        onChangeExpiry={handleChangeExpiry}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-6">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold">{isLoading ? "—" : fmt(c.value)}</p>
              <p className="mt-1 text-xs font-light text-muted-foreground">{c.hint}</p>
              {comparing && !isLoading && !prior.isLoading ? (
                <p className="mt-2 text-xs tabular-nums">
                  <span
                    className={
                      Math.abs(c.value - c.priorValue) < 0.005
                        ? "text-muted-foreground"
                        : c.value > c.priorValue
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                    }
                  >
                    {c.value >= c.priorValue ? "+" : "−"}
                    {fmt(Math.abs(c.value - c.priorValue))}
                    {c.priorValue !== 0
                      ? ` (${(((c.value - c.priorValue) / Math.abs(c.priorValue)) * 100).toFixed(1)}%)`
                      : ""}
                  </span>{" "}
                  <span className="font-light text-muted-foreground">
                    vs {fmt(c.priorValue)} · {compareLabel}
                  </span>
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <DepreciationTrendCharts
        data={trend}
        isLoading={isLoading}
        format={fmt}
        periodLabel={periodLabel}
        branchScopeLabel={branchScopeLabel}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Breakdown</CardTitle>
          <CardDescription className="font-light">
            Grouped by branch, by asset class, or the full branch × class matrix. Asset detail lists
            every item on the register at {format(periodMonth, "MMMM d, yyyy")}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No assets on the register for {periodLabel}.
            </p>
          ) : (
            <Tabs defaultValue="branch">
              <TabsList>
                <TabsTrigger value="branch">
                  <Building2 className="mr-1.5 h-4 w-4" />
                  By branch
                </TabsTrigger>
                <TabsTrigger value="class">
                  <Layers className="mr-1.5 h-4 w-4" />
                  By class
                </TabsTrigger>
                <TabsTrigger value="matrix">Branch × class</TabsTrigger>
                <TabsTrigger value="detail">Asset detail</TabsTrigger>
              </TabsList>

              <TabsContent value="branch" className="mt-4">
                <GroupTable
                  groups={byBranch}
                  fmt={fmt}
                  totals={totals}
                  firstHeader="Branch"
                  priorGroups={comparing ? priorGroups.branch : undefined}
                  priorTotals={comparing ? prior.totals : undefined}
                  compareLabel={compareLabel}
                />
              </TabsContent>
              <TabsContent value="class" className="mt-4">
                <GroupTable
                  groups={byClass}
                  fmt={fmt}
                  totals={totals}
                  firstHeader="Asset class"
                  priorGroups={comparing ? priorGroups.class : undefined}
                  priorTotals={comparing ? prior.totals : undefined}
                  compareLabel={compareLabel}
                />
              </TabsContent>
              <TabsContent value="matrix" className="mt-4">
                <GroupTable
                  groups={byBranchClass}
                  fmt={fmt}
                  totals={totals}
                  firstHeader="Branch"
                  secondHeader="Asset class"
                  priorGroups={comparing ? priorGroups.matrix : undefined}
                  priorTotals={comparing ? prior.totals : undefined}
                  compareLabel={compareLabel}
                />
              </TabsContent>

              <TabsContent value="detail" className="mt-4">
                <div className="overflow-x-auto">
                  <Table className={comparing ? "min-w-[1320px]" : "min-w-[1000px]"}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Opening accum.</TableHead>
                        <TableHead className="text-right">Period charge</TableHead>
                        <TableHead className="text-right">Closing accum.</TableHead>
                        <TableHead className="text-right">Net book value</TableHead>
                        {comparing ? (
                          <>
                            <TableHead className="text-right">NBV · {compareLabel}</TableHead>
                            <TableHead className="text-right">Δ NBV</TableHead>
                          </>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const p = priorRowById.get(r.assetId);
                        return (
                        <TableRow key={r.assetId}>
                          <TableCell>
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs font-light text-muted-foreground">
                              {r.assetTag ? `${r.assetTag} · ` : ""}
                              In service {format(new Date(r.inServiceDate), "MMM d, yyyy")}
                              {r.disposedInPeriod ? " · disposed this period" : ""}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{r.branchName}</TableCell>
                          <TableCell className="text-sm">{r.className}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-normal">
                              {r.method === "reducing_balance" ? "Reducing balance" : "Straight line"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(r.cost)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {fmt(r.openingAccumulated)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmt(r.periodExpense)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmt(r.closingAccumulated)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {fmt(r.netBookValue)}
                          </TableCell>
                          {comparing ? (
                            <>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {p ? fmt(p.netBookValue) : "—"}
                              </TableCell>
                              <VarianceCell
                                current={r.netBookValue}
                                prior={p?.netBookValue ?? 0}
                                fmt={fmt}
                              />
                            </>
                          ) : null}
                        </TableRow>
                        );
                      })}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell colSpan={4}>Total · {totals.assetCount} assets</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(totals.cost)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(totals.openingAccumulated)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(totals.periodExpense)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(totals.closingAccumulated)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(totals.netBookValue)}
                        </TableCell>
                        {comparing ? (
                          <>
                            <TableCell className="text-right tabular-nums">
                              {fmt(prior.totals.netBookValue)}
                            </TableCell>
                            <VarianceCell
                              current={totals.netBookValue}
                              prior={prior.totals.netBookValue}
                              fmt={fmt}
                            />
                          </>
                        ) : null}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      <DepreciationReconciliation
        period={period}
        periodEndKey={periodEndKey}
        periodLabel={format(periodMonth, "MMMM yyyy")}
        branchId={branchId}
        branchLabel={
          branchId === "all"
            ? "All branches"
            : branches.find((b) => b.id === branchId)?.name ?? "Selected branch"
        }
        registerPeriodExpense={totals.periodExpense}
        registerAccumulated={totals.closingAccumulated}
        fmt={fmt}
      />
    </div>
  );
}

function GroupTable({
  groups,
  fmt,
  totals,
  firstHeader,
  secondHeader,
  priorGroups,
  priorTotals,
  compareLabel,
}: {
  groups: DepreciationGroup[];
  fmt: (n: number) => string;
  totals: DepreciationTotals;
  firstHeader: string;
  secondHeader?: string;
  priorGroups?: Map<string, DepreciationGroup>;
  priorTotals?: DepreciationTotals;
  compareLabel?: string;
}) {
  const comparing = !!priorGroups && !!priorTotals;
  const empty: DepreciationGroup = {
    key: "",
    label: "",
    cost: 0,
    openingAccumulated: 0,
    periodExpense: 0,
    closingAccumulated: 0,
    netBookValue: 0,
    assetCount: 0,
    rows: [],
  };
  return (
    <div className="overflow-x-auto">
      <Table className={comparing ? "min-w-[1180px]" : "min-w-[860px]"}>
        <TableHeader>
          <TableRow>
            <TableHead>{firstHeader}</TableHead>
            {secondHeader ? <TableHead>{secondHeader}</TableHead> : null}
            <TableHead className="text-right">Assets</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Opening accum.</TableHead>
            <TableHead className="text-right">Period charge</TableHead>
            {comparing ? (
              <>
                <TableHead className="text-right">Charge · {compareLabel}</TableHead>
                <TableHead className="text-right">Δ charge</TableHead>
              </>
            ) : null}
            <TableHead className="text-right">Closing accum.</TableHead>
            <TableHead className="text-right">Net book value</TableHead>
            {comparing ? (
              <>
                <TableHead className="text-right">NBV · {compareLabel}</TableHead>
                <TableHead className="text-right">Δ NBV</TableHead>
              </>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const p = priorGroups?.get(g.key) ?? empty;
            return (
            <TableRow key={g.key}>
              <TableCell className="font-medium">{secondHeader ? g.sublabel : g.label}</TableCell>
              {secondHeader ? <TableCell>{g.label}</TableCell> : null}
              <TableCell className="text-right tabular-nums">{g.assetCount}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(g.cost)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmt(g.openingAccumulated)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmt(g.periodExpense)}</TableCell>
              {comparing ? (
                <>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmt(p.periodExpense)}
                  </TableCell>
                  <VarianceCell current={g.periodExpense} prior={p.periodExpense} fmt={fmt} invert />
                </>
              ) : null}
              <TableCell className="text-right tabular-nums">{fmt(g.closingAccumulated)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {fmt(g.netBookValue)}
              </TableCell>
              {comparing ? (
                <>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmt(p.netBookValue)}
                  </TableCell>
                  <VarianceCell current={g.netBookValue} prior={p.netBookValue} fmt={fmt} />
                </>
              ) : null}
            </TableRow>
            );
          })}
          <TableRow className="border-t-2 font-semibold">
            <TableCell colSpan={secondHeader ? 2 : 1}>Total</TableCell>
            <TableCell className="text-right tabular-nums">{totals.assetCount}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(totals.cost)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(totals.openingAccumulated)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(totals.periodExpense)}</TableCell>
            {comparing && priorTotals ? (
              <>
                <TableCell className="text-right tabular-nums">
                  {fmt(priorTotals.periodExpense)}
                </TableCell>
                <VarianceCell
                  current={totals.periodExpense}
                  prior={priorTotals.periodExpense}
                  fmt={fmt}
                  invert
                />
              </>
            ) : null}
            <TableCell className="text-right tabular-nums">{fmt(totals.closingAccumulated)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(totals.netBookValue)}</TableCell>
            {comparing && priorTotals ? (
              <>
                <TableCell className="text-right tabular-nums">
                  {fmt(priorTotals.netBookValue)}
                </TableCell>
                <VarianceCell
                  current={totals.netBookValue}
                  prior={priorTotals.netBookValue}
                  fmt={fmt}
                />
              </>
            ) : null}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
