import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";

export interface UnpaidEntry {
  count: number;
  amount: number;
}

/**
 * Unpaid (customer-tab) balances aggregated per customer.
 * Scoped to the active branch when one is selected; falls back to the
 * whole tenant when the user is viewing "All branches".
 */
export function useBranchUnpaidBalances() {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();

  const { data, isLoading } = useQuery({
    queryKey: ["branch-unpaid-balances", restaurant?.id, activeBranchId],
    queryFn: async () => {
      if (!restaurant?.id) return {} as Record<string, UnpaidEntry>;
      let query = supabase
        .from("sales_transactions")
        .select("customer_id, total")
        .eq("restaurant_id", restaurant.id)
        .eq("settlement_status", "unpaid")
        .not("customer_id", "is", null);
      if (activeBranchId) query = query.eq("branch_id", activeBranchId);

      const { data: rows, error } = await query;
      if (error) throw error;

      const map: Record<string, UnpaidEntry> = {};
      rows?.forEach((tx: { customer_id: string | null; total: number | null }) => {
        if (!tx.customer_id) return;
        const entry = map[tx.customer_id] ?? { count: 0, amount: 0 };
        entry.count += 1;
        entry.amount += Number(tx.total || 0);
        map[tx.customer_id] = entry;
      });
      return map;
    },
    enabled: !!restaurant?.id,
  });

  const byCustomer = data ?? {};
  const totalOutstanding = Object.values(byCustomer).reduce((s, e) => s + e.amount, 0);

  return {
    byCustomer,
    totalOutstanding,
    /** True when the figures are limited to a single branch. */
    isBranchScoped: !!activeBranchId,
    isLoading,
  };
}
