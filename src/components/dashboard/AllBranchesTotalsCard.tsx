import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Receipt, TrendingUp, CalendarIcon, RefreshCw, Info, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { computeBounds } from "@/hooks/useDashboardData";
import { getTenantYesterdayDate } from "@/lib/timezone";
import { Skeleton } from "@/components/ui/skeleton";
import { format as formatDate } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  dateRange?: { from?: Date; to?: Date };
  /** Optional label describing the selected period, e.g. "Today". */
  periodLabel?: string;
}

interface BranchTotals {
  branchId: string;
  name: string;
  /** Final sales figure used in the totals (declared summary wins over POS). */
  sales: number;
  /** Sum of POS transactions in the 24h window. */
  posSales: number;
  /** Declared day-close sales (daily_sales_summary), null when not submitted. */
  declaredSales: number | null;
  expenses: number;
}


/**
 * Group-wide (all branches combined) sales and expenses for the selected
 * period. Deliberately ignores the active branch filter so owners always see
 * the consolidated figure plus a per-branch split.
 */
export function AllBranchesTotalsCard({ dateRange, periodLabel }: Props) {
  const { restaurant } = useAuth();
  const { branches } = useBranch();
  const { format: money } = useCurrency();
  const restaurantId = restaurant?.id;
  const timezone = restaurant?.timezone || "Asia/Riyadh";

  // Local date picker state: default to the previous business day in the tenant
  // timezone (current date - 1), since today's 11am–11am day is still in progress.
  const [selectedDate, setSelectedDate] = useState<Date>(() => getTenantYesterdayDate(timezone));
  const [showBreakdown, setShowBreakdown] = useState(false);


  // The card's own picker is authoritative: it always shows one full
  // calendar day (midnight → midnight, tenant timezone) across all branches.
  const effectiveRange = useMemo(
    () => ({ from: selectedDate, to: selectedDate }),
    [selectedDate],
  );

  const bounds = useMemo(
    () => computeBounds(restaurantId, timezone, effectiveRange as never),
    [restaurantId, timezone, effectiveRange],
  );


  const { data, isLoading, refetch } = useQuery({
    queryKey: [
      "dashboard-all-branch-totals",
      restaurantId,
      bounds.startDate,
      bounds.endDate,
      branches.map((b) => b.id).join(","),
    ],
    enabled: !!restaurantId,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const loadPosSales = async (branchId: string | null) => {
        const { data, error } = await (db as any).rpc("dashboard_sales_summary", {
          p_restaurant_id: restaurantId,
          p_start: bounds.startDateUTC,
          p_end: bounds.endDateUTC,
          p_branch_id: branchId,
        });
        if (error) throw error;
        return Number(data?.[0]?.net_sales ?? 0);
      };
      const loadExpenses = async (branchId: string | null) => {
        const { data, error } = await (db as any).rpc("dashboard_expense_summary", {
          p_restaurant_id: restaurantId,
          p_start_date: bounds.startDate,
          p_end_date: bounds.endDate,
          p_branch_id: branchId,
        });
        if (error) throw error;
        return Number(data?.[0]?.total_expenses ?? 0);
      };

      // Declared day-close totals (11–11 business day submitted by the branch).
      const { data: declaredRows, error: declaredErr } = await db
        .from("daily_sales_summary")
        .select("branch_id, total_sales, sales_date")
        .eq("restaurant_id", restaurantId!)
        .gte("sales_date", bounds.startDate)
        .lte("sales_date", bounds.endDate);
      if (declaredErr) throw declaredErr;

      const declaredByBranch = new Map<string, number>();
      (declaredRows ?? []).forEach((r) => {
        const key = (r.branch_id as string | null) ?? "__untagged__";
        declaredByBranch.set(key, (declaredByBranch.get(key) ?? 0) + Number(r.total_sales || 0));
      });

      const [totalExpenses, perBranch] = await Promise.all([
        loadExpenses(null),
        Promise.all(
          branches.map(async (b) => {
            const [posSales, expenses] = await Promise.all([
              loadPosSales(b.id),
              loadExpenses(b.id),
            ]);
            const declared = declaredByBranch.has(b.id)
              ? (declaredByBranch.get(b.id) as number)
              : null;
            return {
              branchId: b.id,
              name: b.name,
              posSales,
              declaredSales: declared,
              // Declared day-close total wins when submitted, otherwise POS.
              sales: declared !== null ? declared : posSales,
              expenses,
            } as BranchTotals;
          }),
        ),
      ]);

      const totalSales = perBranch.reduce((s, b) => s + b.sales, 0);
      const totalPosSales = perBranch.reduce((s, b) => s + b.posSales, 0);
      const totalDeclared = perBranch.reduce((s, b) => s + (b.declaredSales ?? 0), 0);

      return {
        totalSales,
        totalPosSales,
        totalDeclared,
        totalExpenses,
        perBranch: perBranch as BranchTotals[],
      };
    },
  });

  const totalSales = data?.totalSales ?? 0;
  const totalExpenses = data?.totalExpenses ?? 0;
  const net = totalSales - totalExpenses;

  return (
    <Card className="border-border/40 h-full">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">Group totals — all branches</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Combined across every branch · full day ·{" "}
              {formatDate(selectedDate, "dd MMM yyyy")}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh all-branch totals"
              className="h-8 w-8 shrink-0"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 justify-start text-left font-normal px-2.5",
                    !selectedDate && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                  {selectedDate ? formatDate(selectedDate, "dd MMM yyyy") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Accumulative sales
                </p>
                <p className="text-lg font-semibold mt-1">{money(totalSales)}</p>
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5" /> Accumulative expenses
                </p>
                <p className="text-lg font-semibold mt-1">{money(totalExpenses)}</p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">Sales less expenses</span>
              <span className={`text-sm font-semibold ${net < 0 ? "text-destructive" : "text-primary"}`}>
                {money(net)}
              </span>
            </div>

            {(data?.perBranch?.length ?? 0) > 1 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Per branch</p>
                {data!.perBranch.map((b) => (
                  <div key={b.branchId} className="flex items-center justify-between text-xs">
                    <span className="truncate max-w-[45%]">{b.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {money(b.sales)} · <span className="text-destructive/80">{money(b.expenses)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <Collapsible open={showBreakdown} onOpenChange={setShowBreakdown}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs w-full justify-between">
                  <span className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5" /> Breakdown & formula
                  </span>
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", showBreakdown && "rotate-180")}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-3">
                <div className="rounded-lg border border-border/40 overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-2 py-1.5">Branch</th>
                        <th className="text-right font-medium px-2 py-1.5">POS sales</th>
                        <th className="text-right font-medium px-2 py-1.5">Declared day-close</th>
                        <th className="text-right font-medium px-2 py-1.5">Used</th>
                        <th className="text-right font-medium px-2 py-1.5">Expenses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.perBranch ?? []).map((b) => (
                        <tr key={b.branchId} className="border-t border-border/40">
                          <td className="px-2 py-1.5 truncate max-w-[120px]">{b.name}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(b.posSales)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {b.declaredSales === null ? (
                              <span className="text-muted-foreground">not submitted</span>
                            ) : (
                              money(b.declaredSales)
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                            {money(b.sales)}
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              {b.declaredSales === null ? "(POS)" : "(declared)"}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-destructive/80">
                            {money(b.expenses)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-border/40 bg-muted/30 font-medium">
                        <td className="px-2 py-1.5">Total</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(data?.totalPosSales ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(data?.totalDeclared ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(totalSales)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-destructive/80">
                          {money(totalExpenses)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="text-[11px] text-muted-foreground space-y-1 leading-relaxed">
                  <p className="font-medium text-foreground">How this is calculated</p>
                  <p>
                    <span className="font-medium">Branch sales</span> = declared day-close total
                    (daily sales summary for {formatDate(selectedDate, "dd MMM yyyy")}) when the day was
                    submitted; otherwise the sum of POS sale transactions in that day&apos;s window.
                    This avoids double-counting the same revenue twice.
                  </p>
                  <p>
                    <span className="font-medium">Accumulative sales</span> = Σ branch sales ·{" "}
                    <span className="font-medium">Accumulative expenses</span> = Σ expenses recorded
                    with an expense date of {formatDate(selectedDate, "dd MMM yyyy")} (excluding deleted).
                  </p>
                  <p>
                    <span className="font-medium">Sales less expenses</span> = accumulative sales −
                    accumulative expenses.
                  </p>
                  <p>
                    Window: {formatDate(selectedDate, "dd MMM yyyy")} 00:00 → 24:00 in{" "}
                    {timezone} (full calendar day, all branches).
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </CardContent>
    </Card>
  );
}
