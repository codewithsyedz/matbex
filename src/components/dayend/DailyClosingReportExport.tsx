import { useMemo, useState } from "react";
import { format, endOfDay, startOfDay, subDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { CalendarIcon, Download, FileText, Receipt } from "lucide-react";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BranchBadge } from "@/components/branch/BranchBadge";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import {
  buildClosingReport,
  closingReportToCsv,
  downloadCsv,
  type ClosingReportRow,
} from "@/lib/dailyClosingReport";
import { exportClosingReportPdf } from "@/lib/dailyClosingReportPdf";

/**
 * Branch-wise daily closing report with CSV + PDF export.
 * Shows totals, VAT split, cash breakdown and reconciliation deltas
 * (declared close vs POS + day-end adjustments) per branch per business day.
 */
export function DailyClosingReportExport() {
  const { restaurant, user, profile, role } = useAuth() as any;
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { format: fmt, currencyInfo, displayCurrency } = useCurrency();
  const currencySymbol = currencyInfo?.symbol ?? displayCurrency;

  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const effectiveBranch = pinnedBranchId ?? branchId;
  const branchKey = effectiveBranch && effectiveBranch !== "all" ? effectiveBranch : null;

  const [range, setRange] = useState<DateRange | undefined>({
    from: startOfDay(subDays(new Date(), 6)),
    to: endOfDay(new Date()),
  });

  const fromIso = range?.from ? startOfDay(range.from).toISOString() : null;
  const toIso = range?.to ? endOfDay(range.to).toISOString() : null;
  const fromYmd = range?.from ? format(range.from, "yyyy-MM-dd") : null;
  const toYmd = range?.to ? format(range.to, "yyyy-MM-dd") : null;

  const { data, isLoading } = useQuery({
    queryKey: ["daily-closing-report", restaurant?.id, branchKey, fromIso, toIso],
    enabled: !!restaurant?.id && !!fromIso && !!toIso,
    queryFn: async () => {
      let txQ = db
        .from("sales_transactions")
        .select("branch_id, created_at, total, subtotal, tax, payment_method, is_delivery")
        .eq("restaurant_id", restaurant!.id)
        .gte("created_at", fromIso!)
        .lte("created_at", toIso!);
      if (branchKey) txQ = txQ.eq("branch_id", branchKey);

      let sumQ = db
        .from("daily_sales_summary")
        .select(
          "branch_id, sales_date, total_sales, cash_sales, card_sales, delivery_sales, other_sales, pos_reported_total, system_calculated_total, variance_amount, variance_status, status",
        )
        .eq("restaurant_id", restaurant!.id)
        .gte("sales_date", fromYmd!)
        .lte("sales_date", toYmd!);
      if (branchKey) sumQ = sumQ.eq("branch_id", branchKey);

      let adjQ = db
        .from("day_end_adjustments")
        .select("branch_id, business_date, amount, reversed_at, reversal_of_id")
        .eq("restaurant_id", restaurant!.id)
        .gte("business_date", fromYmd!)
        .lte("business_date", toYmd!);
      if (branchKey) adjQ = adjQ.eq("branch_id", branchKey);

      const [tx, sum, adj] = await Promise.all([txQ, sumQ, adjQ]);
      if (tx.error) throw tx.error;
      if (sum.error) throw sum.error;
      if (adj.error) throw adj.error;

      return buildClosingReport({
        txRows: (tx.data ?? []) as any,
        summaryRows: (sum.data ?? []) as any,
        adjRows: (adj.data ?? []) as any,
        branchNames: new Map(branches.map((b) => [b.id, b.name] as const)),
      });
    },
  });

  const rows: ClosingReportRow[] = data?.rows ?? [];
  const totals = data?.totals;

  const branchLabel = useMemo(() => {
    if (!branchKey) return "All branches";
    return branches.find((b) => b.id === branchKey)?.name ?? "Branch";
  }, [branchKey, branches]);

  const rangeLabel =
    range?.from && range?.to
      ? `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`
      : "—";

  const fileStem = `daily-closing_${branchLabel.replace(/\s+/g, "-").toLowerCase()}_${
    fromYmd ?? "all"
  }_${toYmd ?? "all"}`;

  const handleCsv = () => {
    if (!totals || rows.length === 0) return;
    downloadCsv(`${fileStem}.csv`, closingReportToCsv(rows, totals));
    toast.success("Closing report exported as CSV");
  };

  const handlePdf = () => {
    if (!totals || rows.length === 0) return;
    exportClosingReportPdf(rows, totals, {
      restaurantName: restaurant?.name ?? "Restaurant",
      branchLabel,
      dateRange: rangeLabel,
      currency: currencySymbol,
      filename: `${fileStem}.pdf`,
      auditStamp: {
        exportedBy:
          profile?.full_name || user?.user_metadata?.full_name || user?.email || "Unknown user",
        exportedByEmail: user?.email ?? null,
        role: role ?? null,
        reference: `${fileStem}.pdf`,
        filters: [
          { label: "Restaurant", value: restaurant?.name ?? "—" },
          { label: "Branch", value: branchLabel },
          { label: "Period", value: rangeLabel },
          { label: "Currency", value: currencySymbol },
          { label: "Rows", value: String(rows.length) },
        ],
      },
    });
    toast.success("Closing report exported as PDF");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Daily closing report — {branchLabel}
            </CardTitle>
            <CardDescription>
              Totals, VAT, cash breakdown and reconciliation deltas per branch and business
              day. Delta = declared close − (POS + day-end adjustments).
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSwitchBranches && (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-9 w-[180px]">
                  <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent className="z-50 bg-popover">
                  <SelectItem value="all">All branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {range?.from
                    ? `${format(range.from, "MMM d")} – ${range.to ? format(range.to, "MMM d") : "…"}`
                    : "Pick dates"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0">
                <Calendar
                  mode="range"
                  selected={range}
                  onSelect={setRange}
                  numberOfMonths={2}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={handleCsv}
              disabled={isLoading || rows.length === 0}
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button
              size="sm"
              className="h-9 gap-1.5"
              onClick={handlePdf}
              disabled={isLoading || rows.length === 0}
            >
              <FileText className="h-3.5 w-3.5" /> PDF
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No sales or closures in the selected period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Cash</TableHead>
                  <TableHead className="text-right">Card</TableHead>
                  <TableHead className="text-right">Adjustments</TableHead>
                  <TableHead className="text-right">Declared</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.branchId ?? "none"}-${r.date}`}>
                    <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                    <TableCell>
                      <BranchBadge
                        name={r.branchName === "Unassigned" ? null : r.branchName}
                        branchId={r.branchId}
                        size="sm"
                        untaggedLabel="Unassigned"
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.net)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.vat)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {fmt(r.gross)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.cash)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.card)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(r.adjustments)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.declared == null ? "—" : fmt(r.declared)}
                    </TableCell>
                    <TableCell
                      className={
                        "text-right tabular-nums " +
                        (Math.abs(r.delta) < 0.01
                          ? "text-muted-foreground"
                          : r.delta < 0
                            ? "text-destructive"
                            : "text-success")
                      }
                    >
                      {fmt(r.delta)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "closed"
                            ? "default"
                            : r.status === "adjusted"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {totals && (
                  <TableRow className="bg-muted/40 font-semibold border-t-2">
                    <TableCell colSpan={2}>TOTAL ({totals.txCount} receipts)</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.net)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.vat)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.gross)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.cash)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.card)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(totals.adjustments)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(totals.declared)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.delta)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}