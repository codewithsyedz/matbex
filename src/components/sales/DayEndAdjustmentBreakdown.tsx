import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { BranchBadge, branchDisplayLabel } from "@/components/branch/BranchBadge";
import { Scale, ChevronDown, TrendingUp, TrendingDown, RotateCcw, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportToCSV } from "@/lib/exportUtils";

interface AdjustmentRow {
  id: string;
  branch_id: string | null;
  business_date: string;
  amount: number;
  reason: string;
  notes: string;
  scope: string;
  reversed_at: string | null;
  reversal_of_id: string | null;
  created_at: string;
}

interface Props {
  restaurantId?: string | null;
  dateFrom: string;
  dateTo: string;
  /** Limit to a single day-end scope (defaults to sales overrides). */
  scope?: "daily_sales" | "all";
}

function isActive(a: AdjustmentRow) {
  return !a.reversed_at && !a.reversal_of_id;
}

function humanReason(reason: string) {
  return reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Per-branch day-end adjustment breakdown: shows exactly which overrides
 * changed the reconciled totals, split by branch (including untagged rows that
 * only appear in the "All branches" view).
 */
export function DayEndAdjustmentBreakdown({
  restaurantId,
  dateFrom,
  dateTo,
  scope = "daily_sales",
}: Props) {
  const { branches, activeBranchId, isAllBranches } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const [openBranch, setOpenBranch] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["day-end-adjustment-breakdown", restaurantId, dateFrom, dateTo, scope],
    enabled: !!restaurantId && !!dateFrom && !!dateTo,
    queryFn: async () => {
      let q = supabase
        .from("day_end_adjustments")
        .select(
          "id, branch_id, business_date, amount, reason, notes, scope, reversed_at, reversal_of_id, created_at",
        )
        .eq("restaurant_id", restaurantId!)
        .gte("business_date", dateFrom)
        .lte("business_date", dateTo)
        .order("business_date", { ascending: false });
      if (scope !== "all") q = q.eq("scope", scope);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as AdjustmentRow[];
    },
  });

  const branchNameById = useMemo(() => {
    const m = new Map<string, string>();
    branches.forEach((b) => m.set(b.id, b.name));
    return m;
  }, [branches]);

  const groups = useMemo(() => {
    const all = rows || [];
    // In a single-branch view only that branch's tagged adjustments affect totals.
    const scoped = isAllBranches
      ? all
      : all.filter((a) => a.branch_id === activeBranchId);

    const byBranch = new Map<string, AdjustmentRow[]>();
    for (const a of scoped) {
      const key = a.branch_id ?? "__untagged__";
      const list = byBranch.get(key) || [];
      list.push(a);
      byBranch.set(key, list);
    }

    return Array.from(byBranch.entries())
      .map(([key, list]) => {
        const active = list.filter(isActive);
        const net = active.reduce((s, a) => s + Number(a.amount || 0), 0);
        return {
          key,
          branchId: key === "__untagged__" ? null : key,
          name: key === "__untagged__" ? null : branchNameById.get(key) ?? "Unknown branch",
          rows: list.sort((a, b) => b.business_date.localeCompare(a.business_date)),
          activeCount: active.length,
          reversedCount: list.length - active.length,
          net,
          increases: active.filter((a) => Number(a.amount) > 0).reduce((s, a) => s + Number(a.amount), 0),
          decreases: active.filter((a) => Number(a.amount) < 0).reduce((s, a) => s + Number(a.amount), 0),
        };
      })
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [rows, isAllBranches, activeBranchId, branchNameById]);

  const netTotal = groups.reduce((s, g) => s + g.net, 0);
  const totalActive = groups.reduce((s, g) => s + g.activeCount, 0);

  const handleExport = () => {
    const rowsOut = groups.flatMap((g) =>
      g.rows.map((a) => [
        branchDisplayLabel(g.name),
        g.branchId ?? "",
        a.business_date,
        a.scope,
        humanReason(a.reason),
        a.notes,
        Number(a.amount || 0),
        a.reversed_at ? "reversed" : a.reversal_of_id ? "reversal entry" : "active",
        isActive(a) ? "yes" : "no",
      ]),
    );
    exportToCSV({
      headers: [
        "Branch",
        "Branch ID",
        "Business Date",
        "Scope",
        "Reason",
        "Notes",
        "Amount",
        "Status",
        "Counted In Totals",
      ],
      rows: rowsOut,
      filename: `day-end-adjustments_${dateFrom}_to_${dateTo}`,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Scale className="h-4 w-4 text-muted-foreground" />
              Day-end adjustment breakdown
            </CardTitle>
            <CardDescription>
              {isAllBranches
                ? "Every override applied in this period, grouped by branch. Untagged overrides only count in the All branches view."
                : "Overrides tagged to this branch. Untagged overrides are excluded from branch totals."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Net effect on totals</p>
              <p
                className={cn(
                  "text-lg font-semibold",
                  netTotal > 0 && "text-emerald-600 dark:text-emerald-400",
                  netTotal < 0 && "text-destructive",
                )}
              >
                {netTotal > 0 ? "+" : ""}
                {formatCurrency(netTotal)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!groups.length}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No day-end adjustments in this period — totals come straight from POS
            transactions{isAllBranches ? " and closed-day summaries" : ""}.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {totalActive} active override{totalActive === 1 ? "" : "s"} across{" "}
              {groups.length} branch scope{groups.length === 1 ? "" : "s"}
            </p>

            {groups.map((g) => (
              <Collapsible
                key={g.key}
                open={openBranch === g.key}
                onOpenChange={(o) => setOpenBranch(o ? g.key : null)}
              >
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 hover:bg-accent/50 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                          openBranch === g.key && "rotate-180",
                        )}
                      />
                      <BranchBadge name={g.name} branchId={g.branchId ?? undefined} size="sm" />
                      <span className="text-xs text-muted-foreground truncate">
                        {g.activeCount} active
                        {g.reversedCount > 0 && ` · ${g.reversedCount} reversed`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {g.increases > 0 && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          {formatCurrency(g.increases)}
                        </span>
                      )}
                      {g.decreases < 0 && (
                        <span className="text-xs text-destructive flex items-center gap-1">
                          <TrendingDown className="h-3 w-3" />
                          {formatCurrency(g.decreases)}
                        </span>
                      )}
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          g.net > 0 && "text-emerald-600 dark:text-emerald-400",
                          g.net < 0 && "text-destructive",
                        )}
                      >
                        {g.net > 0 ? "+" : ""}
                        {formatCurrency(g.net)}
                      </span>
                    </div>
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <ScrollArea className="max-h-72 mt-1">
                    <div className="space-y-1 pr-2">
                      {g.rows.map((a) => {
                        const active = isActive(a);
                        return (
                          <div
                            key={a.id}
                            className={cn(
                              "flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm",
                              !active && "opacity-60",
                            )}
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium">{a.business_date}</span>
                                <Badge variant="secondary" className="text-[10px]">
                                  {humanReason(a.reason)}
                                </Badge>
                                {a.scope !== "daily_sales" && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {humanReason(a.scope)}
                                  </Badge>
                                )}
                                {a.reversed_at && (
                                  <Badge variant="outline" className="text-[10px] gap-1">
                                    <RotateCcw className="h-2.5 w-2.5" />
                                    Reversed
                                  </Badge>
                                )}
                                {a.reversal_of_id && (
                                  <Badge variant="outline" className="text-[10px]">
                                    Reversal entry
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 break-words">
                                {a.notes}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "font-semibold tabular-nums shrink-0",
                                Number(a.amount) > 0 && "text-emerald-600 dark:text-emerald-400",
                                Number(a.amount) < 0 && "text-destructive",
                              )}
                            >
                              {Number(a.amount) > 0 ? "+" : ""}
                              {formatCurrency(Number(a.amount || 0))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
