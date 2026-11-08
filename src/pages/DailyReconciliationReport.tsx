import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { Scale, RefreshCw, Download, TriangleAlert, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ar, enUS } from "date-fns/locale";

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";

interface ReconRow {
  id: string;
  branch_id: string | null;
  business_date: string;
  pos_total: number;
  pos_txn_count: number;
  cashier_total: number;
  cashier_sources: { daily_sales_summary?: number; night_shift_summaries?: number } | null;
  ledger_revenue: number;
  ledger_vat: number;
  variance_pos_vs_cashier: number;
  variance_cashier_vs_ledger: number;
  status: string;
  tolerance: number;
  generated_at: string;
}

const STATUS_META: Record<string, { label: string; className?: string; variant?: "secondary" | "destructive" | "outline" }> = {
  balanced: { label: "Balanced", variant: "secondary" },
  divergent: { label: "Divergent", variant: "destructive" },
  missing_pos: { label: "Missing POS", className: "bg-amber-500" },
  missing_cashier: { label: "Missing cashier", className: "bg-amber-500" },
  missing_ledger: { label: "Not posted", className: "bg-amber-500" },
  no_activity: { label: "No activity", variant: "outline" },
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const m = STATUS_META[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={m.variant} className={m.className}>{t(`reports.dailyRecon.statuses.${status}`, { defaultValue: m.label })}</Badge>;
}

export default function DailyReconciliationReport() {
  const { restaurant, hasRole } = useAuth();
  const { branches } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("ar") ? ar : enUS;

  const canView = hasRole("owner") || hasRole("manager") || hasRole("accountant");
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState("flagged");

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["daily-reconciliation", restaurant?.id, from, to],
    enabled: !!restaurant?.id && canView,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("daily_reconciliation_reports")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .gte("business_date", from)
        .lte("business_date", to)
        .order("business_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReconRow[];
    },
  });

  const rerun = useMutation({
    mutationFn: async () => {
      const { data, error } = await (db as any).rpc("rerun_daily_reconciliation_range", {
        p_restaurant_id: restaurant!.id,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast.success(t("reports.dailyRecon.refreshed", { count: n }));
      queryClient.invalidateQueries({ queryKey: ["daily-reconciliation"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const branchName = (id: string | null) =>
    branches.find((b: any) => b.id === id)?.name ?? (id ? t("reports.dailyRecon.unknownBranch") : t("reports.dailyRecon.unassigned"));

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => branchFilter === ALL || (r.branch_id ?? UNASSIGNED) === branchFilter)
        .filter((r) =>
          statusFilter === ALL
            ? true
            : statusFilter === "flagged"
              ? r.status !== "balanced" && r.status !== "no_activity"
              : r.status === statusFilter,
        ),
    [rows, branchFilter, statusFilter],
  );

  const summary = useMemo(() => {
    const scope = rows.filter((r) => branchFilter === ALL || (r.branch_id ?? UNASSIGNED) === branchFilter);
    const flagged = scope.filter((r) => r.status !== "balanced" && r.status !== "no_activity");
    return {
      days: new Set(scope.map((r) => r.business_date)).size,
      flagged: flagged.length,
      posVsCashier: flagged.reduce((s, r) => s + Math.abs(Number(r.variance_pos_vs_cashier)), 0),
      cashierVsLedger: flagged.reduce((s, r) => s + Math.abs(Number(r.variance_cashier_vs_ledger)), 0),
      lastRun: scope.reduce<string | null>(
        (b, r) => (!b || new Date(r.generated_at) > new Date(b) ? r.generated_at : b),
        null,
      ),
    };
  }, [rows, branchFilter]);

  const exportCsv = () => {
    const header = [
      "Date", "Branch", "Status", "POS total", "POS txns", "Cashier total",
      "Ledger revenue", "Ledger VAT", "POS vs cashier", "Cashier vs ledger",
    ];
    const lines = filtered.map((r) =>
      [
        r.business_date,
        branchName(r.branch_id),
        STATUS_META[r.status]?.label ?? r.status,
        r.pos_total,
        r.pos_txn_count,
        r.cashier_total,
        r.ledger_revenue,
        r.ledger_vat,
        r.variance_pos_vs_cashier,
        r.variance_cashier_vs_ledger,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-reconciliation-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canView) {
    return (
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">{t("reports.dailyRecon.notAvailable")}</CardTitle>
            <CardDescription>{t("reports.dailyRecon.access")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" /> {t("reports.dailyRecon.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            POS terminal takings vs cashier-declared sales vs posted ledger revenue — generated automatically each night,
            per branch.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 me-2" /> CSV
          </Button>
          <Button size="sm" onClick={() => rerun.mutate()} disabled={rerun.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${rerun.isPending ? "animate-spin" : ""}`} /> Re-run range
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t("reports.dailyRecon.days")} value={summary.days} />
        <Stat
          label={t("reports.dailyRecon.flaggedDays")}
          value={summary.flagged}
          tone={summary.flagged > 0 ? "bad" : "ok"}
        />
        <Stat label={t("reports.dailyRecon.posCashier")} value={formatCurrency(summary.posVsCashier)} small />
        <Stat label={t("reports.dailyRecon.cashierLedger")} value={formatCurrency(summary.cashierVsLedger)} small />
      </div>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="text-base font-medium">{t("reports.dailyRecon.results")}</CardTitle>
              <CardDescription>
                {t("reports.dailyRecon.resultDescription")} {" "}
                {summary.lastRun ? t("reports.dailyRecon.lastGenerated", { date: format(new Date(summary.lastRun), "PPp", { locale: dateLocale }) }) : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("reports.dailyRecon.allBranches")}</SelectItem>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                  <SelectItem value={UNASSIGNED}>{t("reports.dailyRecon.unassigned")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flagged">{t("reports.dailyRecon.flaggedOnly")}</SelectItem>
                  <SelectItem value={ALL}>{t("reports.dailyRecon.allStatuses")}</SelectItem>
                  <SelectItem value="divergent">{t("reports.dailyRecon.statuses.divergent")}</SelectItem>
                  <SelectItem value="missing_pos">{t("reports.dailyRecon.statuses.missing_pos")}</SelectItem>
                  <SelectItem value="missing_cashier">{t("reports.dailyRecon.statuses.missing_cashier")}</SelectItem>
                  <SelectItem value="missing_ledger">{t("reports.dailyRecon.statuses.missing_ledger")}</SelectItem>
                  <SelectItem value="balanced">{t("reports.dailyRecon.statuses.balanced")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("reports.dailyRecon.columns.date")}</TableHead>
                <TableHead>{t("reports.dailyRecon.columns.branch")}</TableHead>
                <TableHead className="text-end">{t("reports.dailyRecon.columns.pos")}</TableHead>
                <TableHead className="text-end">{t("reports.dailyRecon.columns.txns")}</TableHead>
                <TableHead className="text-end">{t("reports.dailyRecon.columns.cashier")}</TableHead>
                <TableHead className="text-end">{t("reports.dailyRecon.columns.ledger")}</TableHead>
                <TableHead className="text-end">{t("reports.dailyRecon.columns.posCashier")}</TableHead>
                <TableHead className="text-end">{t("reports.dailyRecon.columns.cashierLedger")}</TableHead>
                <TableHead>{t("reports.dailyRecon.columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const gross = Number(r.ledger_revenue) + Number(r.ledger_vat);
                const v1 = Number(r.variance_pos_vs_cashier);
                const v2 = Number(r.variance_cashier_vs_ledger);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{r.business_date}</TableCell>
                    <TableCell className="text-sm">{branchName(r.branch_id)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(r.pos_total))}</TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">{r.pos_txn_count}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(Number(r.cashier_total))}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(gross)}</TableCell>
                    <TableCell className={`text-end tabular-nums ${Math.abs(v1) > Number(r.tolerance) ? "text-destructive" : ""}`}>
                      {formatCurrency(v1)}
                    </TableCell>
                    <TableCell className={`text-end tabular-nums ${Math.abs(v2) > Number(r.tolerance) ? "text-destructive" : ""}`}>
                      {formatCurrency(v2)}
                    </TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-5 w-5 mx-auto mb-2 text-emerald-600" />
                    {t("reports.dailyRecon.help.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-amber-500" /> {t("reports.dailyRecon.help.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>{t("reports.dailyRecon.help.missingPos")}</p>
          <p>{t("reports.dailyRecon.help.missingCashier")}</p>
          <p>{t("reports.dailyRecon.help.notPosted")}</p>
          <p>{t("reports.dailyRecon.help.divergent")}</p>
          <p className="pt-2">{t("reports.dailyRecon.help.schedule")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label, value, tone = "neutral", small,
}: { label: string; value: string | number; tone?: "neutral" | "ok" | "bad"; small?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`${small ? "text-lg" : "text-2xl"} font-light mt-1 ${tone === "bad" ? "text-destructive" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}