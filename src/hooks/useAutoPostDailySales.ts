import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatZonedYMD } from "@/lib/timezone";
import { toast } from "sonner";
import { AiIncomeNeedsReviewError, postSalesToConfirmedAccount, postSalesWithAi } from "@/lib/aiIncomeJournal";

export interface PendingSalesDay {
  id: string;
  salesDate: string;
  branchId: string | null;
  netSales: number;
  status: string;
}

/**
 * Closed/approved daily sales summaries that have not been posted to the ledger yet, up to
 * the selected date: the last `lookbackDays` days, or every one when `lookbackDays` is 0
 * (a closed day left unposted is missing from revenue however old it is).
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
        .lte("sales_date", endStr)
        .in("status", ["closed", "approved"])
        .or("ledger_posted.is.null,ledger_posted.eq.false")
        .order("sales_date", { ascending: true });

      if (lookbackDays > 0) q = q.gte("sales_date", startStr);
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
    mutationFn: async (input: PendingSalesDay[] | { days: PendingSalesDay[]; accountId: string | null }) => {
      // accountId: the revenue account a person chose for all these days (posted as confirmed);
      // null: the AI chooses per day and asks when unsure.
      const { days, accountId } = Array.isArray(input) ? { days: input, accountId: null } : input;
      let posted = 0;
      const failures: string[] = [];
      const toConfirm: string[] = [];
      for (const day of days) {
        try {
          if (accountId) await postSalesToConfirmedAccount(day.id, accountId);
          else await postSalesWithAi(day.id);
          posted++;
        } catch (error) {
          // A person confirms the revenue account on the day's Day-End screen; never here.
          if (error instanceof AiIncomeNeedsReviewError) toConfirm.push(day.salesDate);
          else failures.push(`${day.salesDate}: ${error instanceof Error ? error.message : "AI posting failed"}`);
        }
      }
      return { posted, failures, toConfirm };
    },
    onSuccess: ({ posted, failures, toConfirm }) => {
      if (toConfirm.length > 0) {
        toast.info(`${toConfirm.length} day(s) need you to confirm the revenue account`, {
          description: `Open Sales → Day-End for: ${toConfirm.slice(0, 5).join(", ")}`,
          duration: 15000,
        });
      }
      if (failures.length === 0) {
        if (posted > 0) toast.success(`${posted} day(s) of net sales posted to the ledger`);
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
