import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatZonedYMD } from "@/lib/timezone";
import { toast } from "sonner";
import { postSalesWithAi } from "@/lib/aiIncomeJournal";

export interface PendingSalesDay {
  id: string;
  salesDate: string;
  branchId: string | null;
  netSales: number;
  status: string;
}

/**
 * Closed/approved daily sales summaries that have not been posted to the ledger yet,
 * looking back `lookbackDays` from the selected date.
 */
export function usePendingDailySalesPostings(
  date: Date,
  branchId: string | null,
  lookbackDays = 60,
) {
  const { restaurant } = useAuth();
  const tz = restaurant?.timezone || "UTC";
  const endStr = formatZonedYMD(date, tz);
  const start = new Date(date);
  start.setDate(start.getDate() - lookbackDays);
  const startStr = formatZonedYMD(start, tz);
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  return useQuery<PendingSalesDay[]>({
    queryKey: ["auto-post-daily-sales", restaurant?.id, branchKey, startStr, endStr],
    enabled: !!restaurant?.id,
    staleTime: 15_000,
    queryFn: async () => {
      let q = db
        .from("daily_sales_summary")
        .select("id, sales_date, total_sales, status, ledger_posted, branch_id")
        .eq("restaurant_id", restaurant!.id)
        .gte("sales_date", startStr)
        .lte("sales_date", endStr)
        .in("status", ["closed", "approved"])
        .or("ledger_posted.is.null,ledger_posted.eq.false")
        .order("sales_date", { ascending: true });

      if (branchKey) q = q.eq("branch_id", branchKey);

      const { data, error } = await q;
      if (error) throw error;

      return (data || []).map((s: any) => ({
        id: s.id,
        salesDate: s.sales_date,
        branchId: s.branch_id ?? null,
        netSales: Number(s.total_sales || 0),
        status: s.status,
      }));
    },
  });
}

/** Post net sales for every pending day in one go. */
export function useAutoPostDailySales() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (days: PendingSalesDay[]) => {
      let posted = 0;
      const failures: string[] = [];
      for (const day of days) {
        try {
          await postSalesWithAi(day.id);
          posted++;
        } catch (error) {
          failures.push(`${day.salesDate}: ${error instanceof Error ? error.message : "AI posting failed"}`);
        }
      }
      return { posted, failures };
    },
    onSuccess: ({ posted, failures }) => {
      if (failures.length === 0) {
        toast.success(`${posted} day(s) of net sales posted to the ledger`);
      } else {
        toast.warning(`${posted} posted, ${failures.length} failed`, {
          description: failures.slice(0, 3).join(" · "),
        });
      }
      for (const key of [
        "auto-post-daily-sales",
        "daily-ledger-posting",
        "daily-profit",
        "profit-loss",
        "account-transactions",
        "trial-balance",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: any) => toast.error("Auto-post failed", { description: e?.message }),
  });
}
