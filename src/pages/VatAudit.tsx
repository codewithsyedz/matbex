import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Percent,
  ArrowRight,
  Wand2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { usePersistedBranchDateFilter } from "@/hooks/usePersistedBranchDateFilter";
import { BranchDateRangeFilter, resolvePreset } from "@/components/filters/BranchDateRangeFilter";
import { db } from "@/integrations/db/client";
import { DEFAULT_PRICES_VAT_INCLUSIVE, VAT_RATE, roundMoney, splitInclusive, splitListed, sumMoney } from "@/lib/vatInclusive";
import { reconcileSaleVat } from "@/lib/api/pos";
import { VatReceiptDrilldown } from "@/components/reports/VatReceiptDrilldown";
import { VatIncidentsPanel } from "@/components/reports/VatIncidentsPanel";
import { VatOutputLedgerReport } from "@/components/reports/VatOutputLedgerReport";
import { VatRestatementLog } from "@/components/reports/VatRestatementLog";
import { VatPostingIntegrityPanel } from "@/components/reports/VatPostingIntegrityPanel";
import { InstallmentVatAlertsPanel } from "@/components/reports/InstallmentVatAlertsPanel";
import { branchDisplayLabel } from "@/components/branch/BranchBadge";
import { useTranslation } from "react-i18next";
import { ar, enUS } from "date-fns/locale";

type IssueKind = "vat_on_top" | "wrong_split" | "missing_vat" | "items_mismatch";

interface AuditRow {
  id: string;
  receipt: string;
  date: string;
  branchId: string | null;
  branchName: string;
  terminalName: string;
  ratePercent: number;
  itemsSum: number;
  before: { subtotal: number; tax: number; total: number };
  after: { subtotal: number; tax: number; total: number };
  issues: IssueKind[];
  delta: number;
}

const ISSUE_LABEL: Record<IssueKind, string> = {
  vat_on_top: "VAT added on top",
  wrong_split: "Net/VAT split incorrect",
  missing_vat: "VAT missing",
  items_mismatch: "Total ≠ line items",
};

const TOL = 0.02;

const chartConfig = {
  count: { label: "Flagged sales", color: "hsl(var(--chart-1))" },
  delta: { label: "VAT delta", color: "hsl(var(--chart-2))" },
  amount: { label: "Total amount", color: "hsl(var(--chart-3))" },
} as const;

export default function VatAudit() {
  const { tenant, restaurant, user, isOwner, isAccountant } = useAuth() as any;
  const { activeBranchId, pinnedBranchId, branches } = useBranch();
  const { format: fmt } = useCurrency();
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("ar") ? ar : enUS;
  const issueLabel = (issue: IssueKind) => t(`reports.vatAudit.issues.${issue}`);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [confirmRow, setConfirmRow] = useState<AuditRow | null>(null);
  const queryClient = useQueryClient();

  const { branchId, setBranchId, preset, setPreset, customRange, setCustomRange } =
    usePersistedBranchDateFilter("vat-audit", tenant?.id, {
      branchId: pinnedBranchId ?? activeBranchId ?? "all",
      preset: "this-month",
    });

  const range = preset === "custom" ? customRange : resolvePreset(preset);
  const from = range?.from ?? null;
  const to = range?.to ?? null;

  const rateByBranch = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of branches as any[]) {
      const raw = (b as any).vat_rate;
      const num = typeof raw === "string" ? parseFloat(raw) : raw;
      map[b.id] = typeof num === "number" && isFinite(num) ? num / 100 : VAT_RATE;
    }
    return map;
  }, [branches]);

  // Branch pricing mode: inclusive → listed prices contain VAT; exclusive → VAT is added on top.
  const inclusiveByBranch = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const b of branches as any[]) map[b.id] = (b as any).prices_vat_inclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE;
    return map;
  }, [branches]);

  const { data, isLoading } = useQuery({
    queryKey: [
      "vat-audit",
      restaurant?.id,
      branchId,
      from?.toISOString() ?? null,
      to?.toISOString() ?? null,
    ],
    enabled: !!restaurant?.id && !!from && !!to,
    staleTime: 60_000,
    queryFn: async (): Promise<AuditRow[]> => {
      let q = (db as any)
        .from("sales_transactions")
        .select("id, receipt_number, created_at, branch_id, subtotal, tax, total, zatca_device_id, document_discount, document_surcharge")
        .eq("restaurant_id", restaurant!.id)
        .gte("created_at", from!.toISOString())
        .lte("created_at", to!.toISOString())
        .order("created_at", { ascending: false })
        .limit(3000);
      if (branchId && branchId !== "all") {
        if (branchId === "untagged") q = q.is("branch_id", null);
        else q = q.eq("branch_id", branchId);
      }
      const { data: txns, error } = await q;
      if (error) throw error;

      // Terminal names come from the ZATCA device registered to the POS terminal.
      const deviceIds = Array.from(
        new Set((txns ?? []).map((t: any) => t.zatca_device_id).filter(Boolean)),
      );
      const deviceNames: Record<string, string> = {};
      if (deviceIds.length) {
        const { data: devices } = await (db as any)
          .from("zatca_devices")
          .select("id, name, serial_number")
          .in("id", deviceIds);
        for (const d of (devices ?? []) as any[]) {
          deviceNames[d.id] = d.name || d.serial_number || d.id.slice(0, 8);
        }
      }

      const ids = (txns ?? []).map((t: any) => t.id);
      const itemsSum: Record<string, number> = {};
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const { data: items, error: iErr } = await (db as any)
          .from("sales_items")
          .select("transaction_id, total_price")
          .in("transaction_id", chunk);
        if (iErr) throw iErr;
        for (const it of (items ?? []) as any[]) {
          itemsSum[it.transaction_id] =
            (itemsSum[it.transaction_id] ?? 0) + Number(it.total_price ?? 0);
        }
      }

      const rows: AuditRow[] = [];
      for (const t of (txns ?? []) as any[]) {
        const rate = rateByBranch[t.branch_id] ?? VAT_RATE;
        const before = {
          subtotal: roundMoney(Number(t.subtotal ?? 0)),
          tax: roundMoney(Number(t.tax ?? 0)),
          total: roundMoney(Number(t.total ?? 0)),
        };
        const inclusive = inclusiveByBranch[t.branch_id] ?? DEFAULT_PRICES_VAT_INCLUSIVE;
        const lines = itemsSum[t.id] != null ? roundMoney(itemsSum[t.id]) : null;
        const issues: IssueKind[] = [];

        // Expected split: from the lines (with the document discount/surcharge) in the branch's
        // pricing mode, else from the stored total with VAT inside. Same rule as the server's
        // POST /api/v1/pos/sales/:id/vat-reconcile, which is what actually applies the fix.
        const listed = lines != null
          ? roundMoney(lines - Number(t.document_discount ?? 0) + Number(t.document_surcharge ?? 0))
          : null;
        const after = listed != null ? splitListed(listed, rate, inclusive) : splitInclusive(before.total, rate);
        const expectedGross = after.gross;
        if (listed != null && Math.abs(before.total - expectedGross) > TOL) {
          if (inclusive && Math.abs(before.total - roundMoney(listed * (1 + rate))) <= TOL) {
            issues.push("vat_on_top");
          } else {
            issues.push("items_mismatch");
          }
        }
        if (before.tax === 0 && expectedGross > 0 && after.vat > 0) issues.push("missing_vat");
        if (
          Math.abs(before.subtotal - after.net) > TOL ||
          Math.abs(before.tax - after.vat) > TOL
        ) {
          if (!issues.includes("missing_vat") && !issues.includes("vat_on_top")) {
            issues.push("wrong_split");
          }
        }
        if (!issues.length) continue;

        rows.push({
          id: t.id,
          receipt: t.receipt_number ?? t.id.slice(0, 8),
          date: t.created_at,
          branchId: t.branch_id ?? null,
          branchName:
            (branches as any[]).find((b) => b.id === t.branch_id)?.name ?? t("reports.vatAudit.unassigned"),
          terminalName: t.zatca_device_id
            ? deviceNames[t.zatca_device_id] ?? t("reports.vatAudit.unknownTerminal")
            : t("reports.vatAudit.manualTerminal"),
          ratePercent: Math.round(rate * 10000) / 100,
          itemsSum: lines ?? 0,
          before,
          after: { subtotal: after.net, tax: after.vat, total: after.gross },
          issues,
          delta: roundMoney(after.gross - before.total),
        });
      }
      return rows;
    },
  });

  const rows = data ?? [];

  const reconcileMutation = useMutation({
    // The server recomputes the split itself and writes the audit_logs entry.
    mutationFn: async (row: AuditRow) => {
      await reconcileSaleVat(row.id, restaurant!.id);
    },
    onSuccess: (_d, row) => {
      toast.success(t("reports.vatAudit.success", { receipt: row.receipt }));
      setConfirmRow(null);
      setDetail(null);
      queryClient.invalidateQueries({ queryKey: ["vat-audit"] });
      queryClient.invalidateQueries({ queryKey: ["vat-audit-trail", row.id] });
    },
    onError: (e: any) => toast.error(e?.message || t("reports.vatAudit.failed")),
  });

  const totals = useMemo(
    () => ({
      count: rows.length,
      taxBefore: sumMoney(rows.map((r) => r.before.tax)),
      taxAfter: sumMoney(rows.map((r) => r.after.tax)),
      totalDelta: sumMoney(rows.map((r) => r.delta)),
    }),
    [rows],
  );

  const periodLabel =
    from && to ? `${format(from, "PP", { locale: dateLocale })} – ${format(to, "PP", { locale: dateLocale })}` : "-";

  const byDay = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; amount: number; delta: number }>();
    for (const r of rows) {
      const key = format(new Date(r.date), "yyyy-MM-dd");
      const entry =
        map.get(key) ??
        { key, label: format(new Date(r.date), "PP", { locale: dateLocale }), count: 0, amount: 0, delta: 0 };
      entry.count += 1;
      entry.amount = roundMoney(entry.amount + r.before.total);
      entry.delta = roundMoney(entry.delta + (r.after.tax - r.before.tax));
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [rows]);

  const byTerminal = useMemo(() => {
    const map = new Map<string, { label: string; count: number; amount: number; delta: number }>();
    for (const r of rows) {
      const entry = map.get(r.terminalName) ?? { label: r.terminalName, count: 0, amount: 0, delta: 0 };
      entry.count += 1;
      entry.amount = roundMoney(entry.amount + r.before.total);
      entry.delta = roundMoney(entry.delta + (r.after.tax - r.before.tax));
      map.set(r.terminalName, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [rows]);

  const worstDay = byDay.slice().sort((a, b) => b.count - a.count)[0];
  const worstTerminal = byTerminal[0];
  const flaggedAmount = useMemo(() => sumMoney(rows.map((r) => r.before.total)), [rows]);
  const vatDelta = useMemo(
    () => sumMoney(rows.map((r) => roundMoney(r.after.tax - r.before.tax))),
    [rows],
  );

  const branchScopeLabel =
    !branchId || branchId === "all"
      ? t("reports.vatAudit.allBranches")
      : (branches as any[]).find((b) => b.id === branchId)?.name ?? branchId;

  const handleExportCsv = () => {
    const lines: string[] = [];
    lines.push(`VAT Audit,${tenant?.name ?? ""}`);
    lines.push(`Period,${periodLabel}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push("");
    lines.push(
      [
        "Receipt",
        "Date",
        "Branch",
        "Branch ID",
        "Terminal",
        "VAT %",
        "Items Sum",
        "Subtotal (before)",
        "VAT (before)",
        "Total (before)",
        "Subtotal (after)",
        "VAT (after)",
        "Total (after)",
        "Total delta",
        "Issues",
      ].join(","),
    );
    for (const r of rows) {
      lines.push(
        [
          r.receipt,
          format(new Date(r.date), "yyyy-MM-dd HH:mm"),
          `"${branchDisplayLabel(r.branchName).replace(/"/g, '""')}"`,
          r.branchId ?? "",
          `"${r.terminalName.replace(/"/g, '""')}"`,
          r.ratePercent.toFixed(2),
          r.itemsSum.toFixed(2),
          r.before.subtotal.toFixed(2),
          r.before.tax.toFixed(2),
          r.before.total.toFixed(2),
          r.after.subtotal.toFixed(2),
          r.after.tax.toFixed(2),
          r.after.total.toFixed(2),
          r.delta.toFixed(2),
          `"${r.issues.map((i) => issueLabel(i)).join("; ")}"`,
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vat-audit-${from ? format(from, "yyyy-MM-dd") : "all"}-to-${
      to ? format(to, "yyyy-MM-dd") : "all"
    }.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Percent className="h-5 w-5 text-primary" /> {t("reports.vatAudit.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sales whose stored totals don’t reconcile with VAT-inclusive math, with the
            corrected split shown side by side.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BranchDateRangeFilter
            branchId={branchId}
            onBranchChange={setBranchId}
            preset={preset}
            onPresetChange={setPreset}
            dateRange={customRange}
            onDateRangeChange={setCustomRange}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleExportCsv}
            disabled={!rows.length}
          >
            <Download className="h-4 w-4" /> {t("reports.vatAudit.export")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t("reports.vatAudit.kpi.flagged")} value={String(totals.count)} tone={totals.count ? "rose" : "green"} />
        <Kpi label={t("reports.vatAudit.kpi.recorded")} value={fmt(totals.taxBefore)} tone="slate" />
        <Kpi label={t("reports.vatAudit.kpi.expected")} value={fmt(totals.taxAfter)} tone="amber" />
        <Kpi label={t("reports.vatAudit.kpi.adjustment")} value={fmt(totals.totalDelta)} tone="rose" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t("reports.vatAudit.kpi.amount")} value={fmt(flaggedAmount)} tone="slate" />
        <Kpi label={t("reports.vatAudit.kpi.delta")} value={fmt(vatDelta)} tone={vatDelta === 0 ? "slate" : "amber"} />
        <Kpi
          label={t("reports.vatAudit.kpi.worstDay")}
          value={worstDay ? `${worstDay.label} · ${worstDay.count}` : "—"}
          tone={worstDay ? "rose" : "green"}
        />
        <Kpi
          label={t("reports.vatAudit.kpi.worstTerminal")}
          value={worstTerminal ? `${worstTerminal.label} · ${worstTerminal.count}` : "—"}
          tone={worstTerminal ? "rose" : "green"}
        />
      </div>

      {rows.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">{t("reports.vatAudit.dayTitle")}</CardTitle>
              <CardDescription>{t("reports.vatAudit.dayDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[240px] w-full">
                <BarChart data={byDay} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) =>
                          name === "count"
                            ? [`${value}`, "Flagged sales"]
                            : [fmt(Number(value)), name === "delta" ? "VAT delta" : "Total amount"]
                        }
                      />
                    }
                  />
                  <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="delta" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} opacity={0.7} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">{t("reports.vatAudit.terminalTitle")}</CardTitle>
              <CardDescription>{t("reports.vatAudit.terminalDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[240px] w-full">
                <BarChart data={byTerminal} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={140}
                    tick={{ fontSize: 11 }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) =>
                          name === "count"
                            ? [`${value}`, "Flagged sales"]
                            : [fmt(Number(value)), "Total amount"]
                        }
                      />
                    }
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {byTerminal.map((t) => (
                      <Cell key={t.label} fill="hsl(var(--chart-1))" />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
              <div className="mt-3 space-y-1">
                {byTerminal.map((t) => (
                  <div key={t.label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate">{t.label}</span>
                    <span className="tabular-nums">
                      {t.count} · {fmt(t.amount)} · Δ {fmt(t.delta)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <VatOutputLedgerReport
        tenantId={tenant?.id}
        branchId={branchId}
        from={from}
        to={to}
        branchNameById={(id) =>
          (branches as any[]).find((b) => b.id === id)?.name ?? t("reports.vatAudit.unassigned")
        }
        fmt={fmt}
        periodLabel={periodLabel}
        branchScopeLabel={branchScopeLabel}
      />

      <VatRestatementLog
        tenantId={tenant?.id}
        branchId={branchId}
        from={from}
        to={to}
        branchNameById={(id) =>
          (branches as any[]).find((b) => b.id === id)?.name ?? t("reports.vatAudit.unassigned")
        }
      />

      <VatPostingIntegrityPanel
        tenantId={tenant?.id}
        branchId={branchId}
        from={from}
        to={to}
        branchNameById={(id) =>
          (branches as any[]).find((b) => b.id === id)?.name ?? t("reports.vatAudit.unassigned")
        }
        fmt={fmt}
        periodLabel={periodLabel}
        branchScopeLabel={branchScopeLabel}
        canManage={!!isOwner || !!isAccountant}
      />

      <InstallmentVatAlertsPanel
        tenantId={tenant?.id}
        branchId={branchId}
        fmt={fmt}
        branchNameById={(id) =>
          (branches as any[]).find((b) => b.id === id)?.name ?? t("reports.vatAudit.unassigned")
        }
        canManage={!!isOwner || !!isAccountant}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">{t("reports.vatAudit.reconciliation")}</CardTitle>
          <CardDescription>
            {periodLabel} · {branchScopeLabel}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !rows.length ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>{t("reports.vatAudit.clean")}</AlertTitle>
              <AlertDescription>
                {t("reports.vatAudit.cleanDesc")}
              </AlertDescription>
            </Alert>
          ) : (
            <ScrollArea className="max-h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("reports.vatAudit.receipt")}</TableHead>
                    <TableHead>{t("reports.vatAudit.date")}</TableHead>
                    <TableHead>{t("reports.vatAudit.branch")}</TableHead>
                    <TableHead>{t("reports.vatAudit.issue")}</TableHead>
                    <TableHead className="text-end">{t("reports.vatAudit.before")}</TableHead>
                    <TableHead className="text-end">{t("reports.vatAudit.after")}</TableHead>
                    <TableHead className="text-end">{t("reports.vatAudit.deltaTotal")}</TableHead>
                    <TableHead className="text-end">{t("reports.vatAudit.action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setDetail(r)}
                    >
                      <TableCell className="font-medium">{r.receipt}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(r.date), "PPp", { locale: dateLocale })}
                      </TableCell>
                      <TableCell>
                        <BranchBadge
                          name={r.branchName}
                          branchId={r.branchId}
                          size="sm"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.issues.map((i) => (
                            <Badge key={i} variant="destructive" className="font-normal">
                              {issueLabel(i)}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">
                        {fmt(r.before.subtotal)} / {fmt(r.before.tax)} / {fmt(r.before.total)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {fmt(r.after.subtotal)} / {fmt(r.after.tax)} / {fmt(r.after.total)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(r.delta)}</TableCell>
                      <TableCell className="text-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmRow(r);
                          }}
                        >
                          <Wand2 className="h-3.5 w-3.5" /> {t("reports.vatAudit.reconcile")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <VatIncidentsPanel
        restaurantId={restaurant?.id}
        branchId={branchId}
        branchName={(id) =>
          (branches as any[]).find((b) => b.id === id)?.name ?? t("reports.vatAudit.unassigned")
        }
        fmt={fmt}
      />

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("reports.vatAudit.drilldown")}</DialogTitle>
            <DialogDescription>
              {detail?.receipt} · {detail?.branchName} · {detail?.terminalName} · VAT{" "}
              {detail?.ratePercent}%
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <VatReceiptDrilldown
              row={{
                ...detail,
                issueLabels: detail.issues.map((i) => issueLabel(i)),
              }}
              fmt={fmt}
              onReconcile={() => setConfirmRow(detail)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRow} onOpenChange={(o) => !o && setConfirmRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reports.vatAudit.confirmTitle", { receipt: confirmRow?.receipt })}</AlertDialogTitle>
            <AlertDialogDescription>
              The stored totals will be replaced with the VAT-inclusive split at{" "}
              {confirmRow?.ratePercent}%. This updates the sale record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmRow && (
            <div className="rounded-md border divide-y">
              <DiffRow label={t("reports.vatAudit.net")} before={fmt(confirmRow.before.subtotal)} after={fmt(confirmRow.after.subtotal)} />
              <DiffRow label={t("reports.vatAudit.vat")} before={fmt(confirmRow.before.tax)} after={fmt(confirmRow.after.tax)} />
              <DiffRow label={t("reports.vatAudit.total")} before={fmt(confirmRow.before.total)} after={fmt(confirmRow.after.total)} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reconcileMutation.isPending}>{t("reports.vatAudit.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmRow) reconcileMutation.mutate(confirmRow);
              }}
              disabled={reconcileMutation.isPending}
            >
              {reconcileMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {t("reports.vatAudit.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="flex items-center justify-between gap-2 p-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 tabular-nums">
        <span className="line-through text-muted-foreground">{before}</span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{after}</span>
      </span>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "amber" | "slate" | "rose";
}) {
  const colorMap = {
    green: "text-emerald-600",
    amber: "text-amber-600",
    slate: "text-foreground",
    rose: "text-rose-600",
  } as const;
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${colorMap[tone]}`}>{value}</div>
      </CardContent>
    </Card>
  );
}