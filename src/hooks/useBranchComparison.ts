import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions } from "@/lib/query/queryPolicy";
import { qk } from "@/lib/query/queryKeys";
import { format } from "date-fns";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export interface BranchPerformanceRow {
  branch_id: string;
  branch_name: string;
  branch_code: string | null;
  is_primary: boolean;
  net_sales: number;
  total_transactions: number;
  paid_sales: number;
  unpaid_sales: number;
  cash_sales: number;
  card_sales: number;
  total_expenses: number;
  cogs_amount: number;
  labor_amount: number;
  prime_cost: number;
  prime_cost_pct: number;
  cash_variance_total: number;
  closed_shifts_count: number;
  perfect_shifts_count: number;
  avg_ticket: number;
}

export interface BranchShiftRow {
  shift_id: string;
  branch_id: string | null;
  branch_name: string;
  cashier_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number | null;
  expected_cash: number | null;
  counted_cash: number | null;
  variance: number | null;
  status: string;
}

export function useBranchComparison(start: Date, end: Date) {
  const { restaurant } = useAuth();
  const startStr = format(start, "yyyy-MM-dd");
  const endStr = format(end, "yyyy-MM-dd");

  return useQuery({
    queryKey: qk.branchComparison.entity("performance", { restaurantId: restaurant?.id, extra: [startStr, endStr] }),
    ...dashboardQueryOptions(),
    enabled: !!restaurant?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<BranchPerformanceRow[]> => {
      const { data, error } = await (db as any).rpc("branch_performance_summary", {
        p_restaurant_id: restaurant!.id,
        p_start_date: startStr,
        p_end_date: endStr,
      });
      if (error) throw error;
      return (data || []) as BranchPerformanceRow[];
    },
  });
}

export function useBranchShiftSummary(start: Date, end: Date) {
  const { restaurant } = useAuth();
  const startStr = format(start, "yyyy-MM-dd");
  const endStr = format(end, "yyyy-MM-dd");

  return useQuery({
    queryKey: qk.branchComparison.entity("shift-summary", { restaurantId: restaurant?.id, extra: [startStr, endStr] }),
    ...dashboardQueryOptions(),
    enabled: !!restaurant?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<BranchShiftRow[]> => {
      const { data, error } = await (db as any).rpc("branch_shift_summary", {
        p_restaurant_id: restaurant!.id,
        p_start_date: startStr,
        p_end_date: endStr,
      });
      if (error) throw error;
      return (data || []) as BranchShiftRow[];
    },
  });
}
