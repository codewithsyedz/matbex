import { useMemo, useState } from "react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Download, Building2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BranchBadge } from "@/components/branch/BranchBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";

/**
 * Per-branch cash closure summary for the 11–11 fiscal cash day.
 *
 * Aggregates the `shifts` table (which already records opening/closing
 * cash balances at the actual open/close moments — typically 11:00 → 11:00
 * next day) and the `cash_events` ledger grouped by branch. Useful for
 * managers to review and close cash drawers branch-by-branch.
 */
export function BranchCashClosureSummary() {
  const { restaurant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { format: fmt } = useCurrency();

  const defaultBranch = pinnedBranchId ?? activeBranchId ?? "all";
  const [branchId, setBranchId] = useState<string>(defaultBranch);
  const effectiveBranch = pinnedBranchId ?? branchId;
  const branchKey = effectiveBranch && effectiveBranch !== "all" ? effectiveBranch : null;

  const [range, setRange] = useState<DateRange | undefined>({
    from: startOfDay(subDays(new Date(), 1)),
    to: endOfDay(new Date()),
  });

  const fromIso = range?.from ? range.from.toISOString() : null;
  const toIso = range?.to ? endOfDay(range.to).toISOString() : null;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["branch-cash-closure", restaurant?.id, branchKey, fromIso, toIso],
    enabled: !!restaurant?.id && !!fromIso && !!toIso,
    queryFn: async () => {
      let shiftQ = db
        .from("shifts")
        .select(
          "id, branch_id, opening_float, counted_cash, expected_cash, variance, opened_at, closed_at, status"
        )
        .eq("restaurant_id", restaurant!.id)
        .gte("opened_at", fromIso!)
        .lte("opened_at", toIso!);
      if (branchKey) shiftQ = shiftQ.eq("branch_id", branchKey);
      const { data: shifts, error: sErr } = await shiftQ;
      if (sErr) throw sErr;

      let eventQ = db
        .from("cash_events")
        .select("shift_id, branch_id, event_type, amount, created_at")
        .eq("restaurant_id", restaurant!.id)
        .gte("created_at", fromIso!)
        .lte("created_at", toIso!);
      if (branchKey) eventQ = eventQ.eq("branch_id", branchKey);
      const { data: events, error: eErr } = await eventQ;
      if (eErr) throw eErr;

      const branchMap = new Map(branches.map((b) => [b.id, b.name] as const));

      type Bucket = {
        branchId: string | null;
        branchName: string;
        shifts: number;
        opening: number;
        sales: number;
        refunds: number;
        drops: number;
        deposits: number;
        adjustments: number;
        expected: number;
        actual: number;
        variance: number;
      };

      const buckets = new Map<string, Bucket>();
      const keyOf = (bid: string | null | undefined) => bid ?? "__unassigned__";

      for (const s of shifts ?? []) {
        const k = keyOf(s.branch_id);
        const cur =
          buckets.get(k) ?? {
            branchId: s.branch_id ?? null,
            branchName: branchMap.get(s.branch_id ?? "") ?? "Unassigned",
            shifts: 0,
            opening: 0,
            sales: 0,
            refunds: 0,
            drops: 0,
            deposits: 0,
            adjustments: 0,
            expected: 0,
            actual: 0,
            variance: 0,
          };
        cur.shifts += 1;
        cur.opening += Number(s.opening_float || 0);
        cur.expected += Number(s.expected_cash || 0);
        cur.actual += Number(s.counted_cash || 0);
        cur.variance += Number(s.variance || 0);
        buckets.set(k, cur);
      }

      for (const e of events ?? []) {
        const k = keyOf(e.branch_id);
        const cur = buckets.get(k);
        if (!cur) continue;
        const amt = Number(e.amount || 0);
        switch (e.event_type) {
          case "sale":
            cur.sales += amt;
            break;
          case "refund":
            cur.refunds += amt;
            break;
          case "drop":
            cur.drops += amt;
            break;
          case "deposit":
            cur.deposits += amt;
            break;
          case "adjustment":
            cur.adjustments += amt;
            break;
        }
      }

      return Array.from(buckets.values()).sort((a, b) =>
        a.branchName.localeCompare(b.branchName),
      );
    },
  });

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        shifts: acc.shifts + r.shifts,
        opening: acc.opening + r.opening,
        sales: acc.sales + r.sales,
        refunds: acc.refunds + r.refunds,
        drops: acc.drops + r.drops,
        deposits: acc.deposits + r.deposits,
        adjustments: acc.adjustments + r.adjustments,
        expected: acc.expected + r.expected,
        actual: acc.actual + r.actual,
        variance: acc.variance + r.variance,
      }),
      {
        shifts: 0,
        opening: 0,
        sales: 0,
        refunds: 0,
        drops: 0,
        deposits: 0,
        adjustments: 0,
        expected: 0,
        actual: 0,
        variance: 0,
      },
    );
  }, [rows]);

  const exportCsv = () => {
    const header = [
      "Branch",
      "Shifts",
      "Opening",
      "Sales",
      "Refunds",
      "Cash Drops",
      "Deposits",
      "Adjustments",
      "Expected",
      "Actual",
      "Variance",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          `"${r.branchName.replace(/"/g, '""')}"`,
          r.shifts,
          r.opening.toFixed(2),
          r.sales.toFixed(2),
          r.refunds.toFixed(2),
          r.drops.toFixed(2),
          r.deposits.toFixed(2),
          r.adjustments.toFixed(2),
          r.expected.toFixed(2),
          r.actual.toFixed(2),
          r.variance.toFixed(2),
        ].join(","),
      );
    }
    lines.push(
      [
        "TOTAL",
        totals.shifts,
        totals.opening.toFixed(2),
        totals.sales.toFixed(2),
        totals.refunds.toFixed(2),
        totals.drops.toFixed(2),
        totals.deposits.toFixed(2),
        totals.adjustments.toFixed(2),
        totals.expected.toFixed(2),
        totals.actual.toFixed(2),
        totals.variance.toFixed(2),
      ].join(","),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `branch-cash-closure_${
      range?.from ? format(range.from, "yyyy-MM-dd") : "all"
    }_${range?.to ? format(range.to, "yyyy-MM-dd") : "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Branch cash closure exported");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Per-branch cash closure (11–11)
            </CardTitle>
            <CardDescription>
              Open/expected/actual cash and ledger events grouped by branch for the
              selected fiscal cash day(s).
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
              onClick={exportCsv}
              disabled={isLoading || rows.length === 0}
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
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
            No shift activity in the selected period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Shifts</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Drops</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                    <TableRow key={r.branchId ?? "unassigned"}>
                      <TableCell className="font-medium">
                        <BranchBadge
                          name={r.branchName === "Unassigned" ? null : r.branchName}
                          branchId={r.branchId}
                          size="sm"
                          untaggedLabel="Unassigned"
                        />
                      </TableCell>
                    <TableCell className="text-right tabular-nums">{r.shifts}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.opening)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.sales)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.drops)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.expected)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.actual)}</TableCell>
                    <TableCell
                      className={
                        "text-right tabular-nums " +
                        (Math.abs(r.variance) < 0.01
                          ? "text-muted-foreground"
                          : r.variance < 0
                            ? "text-destructive"
                            : "text-success")
                      }
                    >
                      {fmt(r.variance)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold border-t-2">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right tabular-nums">{totals.shifts}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.opening)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.sales)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.drops)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.expected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.actual)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.variance)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}