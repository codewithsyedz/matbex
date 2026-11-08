import { useMemo, useState } from "react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Download, Building2, Scale, CalendarIcon, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";

/**
 * Branch reconciliation: compare the operational cash totals coming out of
 * shifts + cash_events (the same numbers shown in BranchCashClosureSummary)
 * against the branch-filtered general ledger for the same window.
 *
 * Sides:
 *  - "Cash drawer": shifts.opening_float + cash_events (sale / refund / drop /
 *    deposit / adjustment) for the selected branch.
 *  - "Ledger": account_transactions filtered by branch_id, bucketed into
 *    Revenue (type=revenue credits), Cash receipts (cash asset debits) and
 *    Cash payouts (cash asset credits). Cash accounts are detected by
 *    account_code prefix "1010" or account name ILIKE %cash%.
 */
export function BranchReconciliationView() {
  const { restaurant, tenant } = useAuth();
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
  const fromYmd = range?.from ? format(range.from, "yyyy-MM-dd") : null;
  const toYmd = range?.to ? format(range.to, "yyyy-MM-dd") : null;

  // --- Drawer side: shifts + cash_events
  const { data: drawer, isLoading: drawerLoading } = useQuery({
    queryKey: ["branch-recon-drawer", restaurant?.id, branchKey, fromIso, toIso],
    enabled: !!restaurant?.id && !!fromIso && !!toIso,
    queryFn: async () => {
      let shiftQ = supabase
        .from("shifts")
        .select("opening_float, counted_cash, expected_cash, variance, branch_id, opened_at")
        .eq("restaurant_id", restaurant!.id)
        .gte("opened_at", fromIso!)
        .lte("opened_at", toIso!);
      if (branchKey) shiftQ = shiftQ.eq("branch_id", branchKey);
      const { data: shifts, error: sErr } = await shiftQ;
      if (sErr) throw sErr;

      let evtQ = supabase
        .from("cash_events")
        .select("event_type, amount, branch_id, created_at")
        .eq("restaurant_id", restaurant!.id)
        .gte("created_at", fromIso!)
        .lte("created_at", toIso!);
      if (branchKey) evtQ = evtQ.eq("branch_id", branchKey);
      const { data: events, error: eErr } = await evtQ;
      if (eErr) throw eErr;

      let opening = 0,
        expected = 0,
        actual = 0,
        variance = 0;
      for (const s of shifts ?? []) {
        opening += Number(s.opening_float || 0);
        expected += Number(s.expected_cash || 0);
        actual += Number(s.counted_cash || 0);
        variance += Number(s.variance || 0);
      }
      let sales = 0,
        refunds = 0,
        drops = 0,
        deposits = 0,
        adjustments = 0;
      for (const e of events ?? []) {
        const amt = Number(e.amount || 0);
        switch (e.event_type) {
          case "sale": sales += amt; break;
          case "refund": refunds += amt; break;
          case "drop": drops += amt; break;
          case "deposit": deposits += amt; break;
          case "adjustment": adjustments += amt; break;
        }
      }
      return { opening, sales, refunds, drops, deposits, adjustments, expected, actual, variance, shiftCount: shifts?.length ?? 0 };
    },
  });

  // --- Ledger side: account_transactions filtered by branch + date range
  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ["branch-recon-ledger", tenant?.id, branchKey, fromYmd, toYmd],
    enabled: !!tenant?.id && !!fromYmd && !!toYmd,
    queryFn: async () => {
      // Pull chart of accounts to classify (cash vs revenue vs other)
      const { data: accounts, error: aErr } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenant!.id);
      if (aErr) throw aErr;

      const cashIds = new Set(
        (accounts ?? [])
          .filter(
            (a) =>
              a.account_code?.startsWith("1010") ||
              /cash|drawer|till/i.test(a.account_name ?? ""),
          )
          .map((a) => a.id),
      );
      const revenueIds = new Set(
        (accounts ?? []).filter((a) => a.account_type === "revenue").map((a) => a.id),
      );

      // Paginate account_transactions for the period + branch
      const pageSize = 1000;
      let page = 0;
      const all: Array<{ account_id: string; debit: number | null; credit: number | null }> = [];
      while (true) {
        let q = supabase
          .from("account_transactions")
          .select("account_id, debit, credit")
          .eq("tenant_id", tenant!.id)
          .eq("is_voided", false)
          .gte("transaction_date", fromYmd!)
          .lte("transaction_date", toYmd!);
        if (branchKey) q = q.eq("branch_id", branchKey);
        const { data, error } = await q.range(page * pageSize, page * pageSize + pageSize - 1);
        if (error) throw error;
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        page += 1;
        if (page > 50) break;
      }

      let revenueCredits = 0,
        revenueDebits = 0,
        cashDebits = 0,
        cashCredits = 0;
      for (const t of all) {
        const d = Number(t.debit ?? 0);
        const c = Number(t.credit ?? 0);
        if (revenueIds.has(t.account_id)) {
          revenueCredits += c;
          revenueDebits += d;
        }
        if (cashIds.has(t.account_id)) {
          cashDebits += d;
          cashCredits += c;
        }
      }
      return {
        revenue: revenueCredits - revenueDebits,
        cashReceipts: cashDebits,
        cashPayouts: cashCredits,
        cashNet: cashDebits - cashCredits,
        txCount: all.length,
      };
    },
  });

  const rows = useMemo(() => {
    if (!drawer || !ledger) return [];
    const drawerRevenue = drawer.sales - drawer.refunds;
    // Cash that left the drawer (drops + deposits) should show up as credits
    // to the cash account in the ledger (i.e. cashPayouts).
    const drawerCashOut = drawer.drops + drawer.deposits;
    return [
      {
        label: "Revenue (cash sales − refunds)",
        drawer: drawerRevenue,
        ledger: ledger.revenue,
      },
      {
        label: "Cash into drawer (sales)",
        drawer: drawer.sales,
        ledger: ledger.cashReceipts,
      },
      {
        label: "Cash out of drawer (drops + deposits)",
        drawer: drawerCashOut,
        ledger: ledger.cashPayouts,
      },
      {
        label: "Net cash movement",
        drawer: drawer.sales - drawer.refunds - drawerCashOut + drawer.adjustments,
        ledger: ledger.cashNet,
      },
    ];
  }, [drawer, ledger]);

  const isLoading = drawerLoading || ledgerLoading;
  const allBalanced =
    rows.length > 0 && rows.every((r) => Math.abs(r.drawer - r.ledger) < 0.01);

  const exportCsv = () => {
    const branchLabel =
      !branchKey
        ? "All branches"
        : branches.find((b) => b.id === branchKey)?.name ?? branchKey;
    const lines: string[] = [];
    lines.push(`Branch Reconciliation,${tenant?.name ?? ""}`);
    lines.push(`Branch,${branchLabel}`);
    lines.push(
      `Period,${range?.from ? format(range.from, "yyyy-MM-dd") : ""},${range?.to ? format(range.to, "yyyy-MM-dd") : ""}`,
    );
    lines.push("");
    lines.push("Line,Drawer,Ledger,Variance");
    for (const r of rows) {
      lines.push(
        [
          `"${r.label}"`,
          r.drawer.toFixed(2),
          r.ledger.toFixed(2),
          (r.drawer - r.ledger).toFixed(2),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `branch-reconciliation_${branchKey ?? "all"}_${
      range?.from ? format(range.from, "yyyy-MM-dd") : "x"
    }_${range?.to ? format(range.to, "yyyy-MM-dd") : "x"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Reconciliation exported");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Scale className="h-4 w-4" /> Branch reconciliation (drawer vs ledger)
            </CardTitle>
            <CardDescription>
              Compare cash drawer totals (shifts + cash events) against the
              branch-filtered general ledger for the same window.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSwitchBranches && (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-9 w-[180px]">
                  <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
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
            No activity in the selected period.
          </div>
        ) : (
          <>
            <div className="px-4 pt-2">
              <Alert variant={allBalanced ? "default" : "destructive"} className="mb-2">
                {allBalanced ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <AlertTitle>
                  {allBalanced ? "Drawer matches ledger" : "Drawer and ledger disagree"}
                </AlertTitle>
                <AlertDescription>
                  {allBalanced
                    ? "Every reconciliation line matches within tolerance for the selected branch and period."
                    : "One or more lines do not match. Investigate the variance column before closing the period."}
                </AlertDescription>
              </Alert>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead className="text-right">Drawer</TableHead>
                    <TableHead className="text-right">Ledger</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const v = r.drawer - r.ledger;
                    const balanced = Math.abs(v) < 0.01;
                    return (
                      <TableRow key={r.label}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(r.drawer)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(r.ledger)}</TableCell>
                        <TableCell
                          className={
                            "text-right tabular-nums " +
                            (balanced
                              ? "text-muted-foreground"
                              : "text-destructive font-medium")
                          }
                        >
                          {balanced ? "—" : fmt(v)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}