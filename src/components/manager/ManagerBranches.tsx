import { Star, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useBranchComparison } from "@/hooks/useBranchComparison";
import { useCurrency } from "@/hooks/useCurrency";
import { cn } from "@/lib/utils";

export function ManagerBranches({ from, to }: { from: Date; to: Date }) {
  const { format: fmt } = useCurrency();
  const { data, isLoading } = useBranchComparison(from, to);

  const rows = [...(data ?? [])].sort((a, b) => b.net_sales - a.net_sales);
  const max = rows.reduce((m, r) => Math.max(m, r.net_sales), 0) || 1;
  const total = rows.reduce((s, r) => s + r.net_sales, 0);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No branch data for this period.</p>;
  }

  return (
    <div className="space-y-3">
      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">All branches revenue</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(total)}</div>
          <p className="text-xs text-muted-foreground">{rows.length} branches in the selected period</p>
        </CardContent>
      </Card>

      {rows.map((r) => (
        <Card key={r.branch_id} className="rounded-2xl">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {r.is_primary && <Star className="h-3.5 w-3.5 shrink-0 text-warning" />}
                  <span className="truncate text-sm font-medium">{r.branch_name}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.total_transactions} orders · avg {fmt(r.avg_ticket)}
                </p>
              </div>
              <div className="text-right">
                <div className="text-base font-semibold tabular-nums">{fmt(r.net_sales)}</div>
                <div className="text-[11px] text-muted-foreground">
                  {total ? ((r.net_sales / total) * 100).toFixed(0) : 0}% of total
                </div>
              </div>
            </div>

            <Progress value={(r.net_sales / max) * 100} className="h-1.5" />

            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Expenses</div>
                <div className="text-xs font-medium tabular-nums">{fmt(r.total_expenses)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Prime cost</div>
                <div
                  className={cn(
                    "text-xs font-medium tabular-nums",
                    r.prime_cost_pct > 65 ? "text-destructive" : r.prime_cost_pct > 60 ? "text-warning" : "text-success",
                  )}
                >
                  {(r.prime_cost_pct ?? 0).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Cash var.</div>
                <div
                  className={cn(
                    "text-xs font-medium tabular-nums",
                    Math.abs(r.cash_variance_total) > 20 ? "text-destructive" : "text-foreground",
                  )}
                >
                  {fmt(r.cash_variance_total)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ArrowUpRight className="h-3 w-3" />
              Unpaid {fmt(r.unpaid_sales)} · Cash {fmt(r.cash_sales)} · Card {fmt(r.card_sales)}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}