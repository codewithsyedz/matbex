import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface PendingExpenseCategory {
  categoryId: string;
  categoryName: string;
  total: number;
  count: number;
  expenseIds: string[];
}

/**
 * Approved, unposted expenses inside the report period, grouped by expense
 * category. Mirrors the Daily Profit auto-post flow but for the P&L period.
 */
export function usePendingExpensePostings(
  fromDate: string | null,
  toDate: string | null,
  branchId: string | null,
) {
  const { restaurant } = useAuth();
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  return useQuery<PendingExpenseCategory[]>({
    queryKey: ["auto-post-expenses", restaurant?.id, branchKey, fromDate, toDate],
    enabled: !!restaurant?.id && !!fromDate && !!toDate,
    staleTime: 15_000,
    queryFn: async () => {
      const db = supabase as any;
      let q = db
        .from("expenses")
        .select(
          "id, amount, expense_date, description, category_id, approval_status, ledger_posted, expense_categories(name)",
        )
        .eq("restaurant_id", restaurant!.id)
        .gte("expense_date", fromDate!)
        .lte("expense_date", toDate!)
        .is("deleted_at", null)
        .or("ledger_posted.is.null,ledger_posted.eq.false");
      if (branchKey) q = q.eq("branch_id", branchKey);

      const { data, error } = await q;
      if (error) throw error;

      const map = new Map<string, PendingExpenseCategory>();
      for (const e of data || []) {
        if (e.approval_status && e.approval_status !== "approved") continue;
        const id = e.category_id || "__uncategorized__";
        const name = e.expense_categories?.name || "Uncategorized";
        const row =
          map.get(id) ??
          { categoryId: id, categoryName: name, total: 0, count: 0, expenseIds: [] };
        row.total += Number(e.amount || 0);
        row.count += 1;
        row.expenseIds.push(e.id);
        map.set(id, row);
      }
      return Array.from(map.values()).sort((a, b) => b.total - a.total);
    },
  });
}

/** Post every pending expense category to the ledger, one category at a time. */
export function useAutoPostExpenses(branchId: string | null) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  return useMutation({
    mutationFn: async (categories: PendingExpenseCategory[]) => {
      const db = supabase as any;
      let posted = 0;
      const failures: string[] = [];
      for (const cat of categories) {
        const { data, error } = await db.rpc("bulk_post_expenses", {
          p_tenant_id: profile?.tenant_id,
          p_branch_id: branchKey,
          p_expense_ids: cat.expenseIds,
        });
        if (error) {
          failures.push(`${cat.categoryName}: ${error.message}`);
          continue;
        }
        const failed = Number(data?.failed || 0);
        posted += Number(data?.posted ?? cat.expenseIds.length) - failed;
        if (failed > 0) {
          failures.push(
            `${cat.categoryName}: ${failed} failed (${data?.details?.[0]?.reason_detail || "see posting center"})`,
          );
        }
      }
      return { posted, failures };
    },
    onSuccess: ({ posted, failures }) => {
      if (failures.length === 0) {
        toast.success(`${posted} expense entr${posted === 1 ? "y" : "ies"} posted to the ledger`);
      } else {
        toast.warning(`${posted} posted, ${failures.length} category(ies) had failures`, {
          description: failures.slice(0, 3).join(" · "),
        });
      }
      for (const key of [
        "auto-post-expenses",
        "daily-ledger-posting",
        "daily-profit",
        "profit-loss",
        "account-transactions",
        "trial-balance",
        "reports-expenses",
        "expenses",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: any) => toast.error("Auto-post failed", { description: e?.message }),
  });
}
