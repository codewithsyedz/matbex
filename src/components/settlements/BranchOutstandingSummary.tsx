import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Wallet, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";

interface BranchOutstandingRow {
  branchId: string | null;
  amount: number;
  invoiceCount: number;
  customerIds: Set<string>;
}

/**
 * Outstanding (unpaid customer-tab) totals broken down per branch.
 *
 * The unpaid rows for every branch are fetched once and aggregated client-side,
 * so switching the active branch re-renders instantly (no refetch, no spinner)
 * while still highlighting / scoping to the selected branch.
 */
export function BranchOutstandingSummary() {
  const { restaurant } = useAuth();
  const { branches, activeBranchId, activeBranch, isAllBranches } = useBranch();
  const { format: formatCurrency } = useCurrency();

  const { data, isLoading } = useQuery({
    // Intentionally NOT keyed on activeBranchId — one fetch serves every branch.
    queryKey: ["settlements-branch-outstanding", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data: rows, error } = await supabase
        .from("sales_transactions")
        .select("branch_id, customer_id, total")
        .eq("restaurant_id", restaurant.id)
        .eq("settlement_status", "unpaid")
        .not("customer_id", "is", null);
      if (error) throw error;
      return rows ?? [];
    },
    enabled: !!restaurant?.id,
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const map = new Map<string | null, BranchOutstandingRow>();
    (data ?? []).forEach((tx) => {
      const key = (tx.branch_id as string | null) ?? null;
      const entry =
        map.get(key) ?? { branchId: key, amount: 0, invoiceCount: 0, customerIds: new Set<string>() };
      entry.amount += Number(tx.total || 0);
      entry.invoiceCount += 1;
      if (tx.customer_id) entry.customerIds.add(tx.customer_id as string);
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [data]);

  const visibleRows = useMemo(
    () => (activeBranchId ? rows.filter((r) => r.branchId === activeBranchId) : rows),
    [rows, activeBranchId],
  );

  const grandTotal = visibleRows.reduce((s, r) => s + r.amount, 0);
  const maxAmount = Math.max(...visibleRows.map((r) => r.amount), 1);

  const branchLabel = (branchId: string | null) => {
    if (!branchId) return { name: "Untagged sales", code: null as string | null };
    const b = branches.find((x) => x.id === branchId);
    return { name: b?.name ?? "Unknown branch", code: b?.code ?? null };
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Outstanding by branch
          </CardTitle>
          <Badge variant="secondary" className="font-normal">
            {isAllBranches || !activeBranchId
              ? "All branches"
              : `${activeBranch?.name ?? "Current branch"}${activeBranch?.code ? ` (${activeBranch.code})` : ""}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No unpaid customer balances for this scope.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <Wallet className="h-4 w-4 text-amber-500 self-center" />
              <span className="text-2xl font-bold text-amber-600">
                {formatCurrency(grandTotal)}
              </span>
              <span className="text-xs text-muted-foreground">
                across {visibleRows.reduce((s, r) => s + r.customerIds.size, 0)} customer(s) ·{" "}
                {visibleRows.reduce((s, r) => s + r.invoiceCount, 0)} unpaid sale(s)
              </span>
            </div>

            <div className="space-y-3">
              {visibleRows.map((row) => {
                const { name, code } = branchLabel(row.branchId);
                const isActive = !!activeBranchId && row.branchId === activeBranchId;
                return (
                  <div
                    key={row.branchId ?? "untagged"}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      isActive ? "border-primary/40 bg-primary/5" : "border-border",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{name}</span>
                        {code && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {code}
                          </Badge>
                        )}
                        {!row.branchId && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                            untagged
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatCurrency(row.amount)}
                      </span>
                    </div>
                    <Progress value={(row.amount / maxAmount) * 100} className="h-1.5 mt-2" />
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {row.customerIds.size} customer(s) · {row.invoiceCount} unpaid sale(s)
                      {grandTotal > 0 && (
                        <span className="ml-1">
                          · {((row.amount / grandTotal) * 100).toFixed(0)}% of total
                        </span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
