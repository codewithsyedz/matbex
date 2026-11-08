import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { postSalesWithAi } from "@/lib/aiIncomeJournal";
import { useAuth } from "@/contexts/AuthContext";
import { formatZonedYMD } from "@/lib/timezone";
import { toast } from "sonner";

export type DailyPostingKind = "sales" | "adjustment" | "overhead" | "expense";

export interface DailyPostingItem {
  id: string;
  kind: DailyPostingKind;
  label: string;
  amount: number;
  posted: boolean;
  blockedReason?: string | null;
}

export interface DailyPostingGroup {
  kind: DailyPostingKind;
  title: string;
  items: DailyPostingItem[];
  postedCount: number;
  pendingCount: number;
  total: number;
}

/**
 * Ledger posting status of every P&L component for a single business day
 * (sales, day-end adjustments, overhead closure, expenses).
 */
export function useDailyLedgerPosting(date: Date, branchId: string | null) {
  const { restaurant, profile } = useAuth();
  const tz = restaurant?.timezone || "UTC";
  const dateStr = formatZonedYMD(date, tz);
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  return useQuery<DailyPostingGroup[]>({
    queryKey: ["daily-ledger-posting", restaurant?.id, branchKey, dateStr],
    enabled: !!restaurant?.id,
    staleTime: 15_000,
    queryFn: async () => {
      const db = supabase as any;

      let salesQ = db
        .from("daily_sales_summary")
        .select("id, sales_date, total_sales, status, ledger_posted, branch_id")
        .eq("restaurant_id", restaurant!.id)
        .eq("sales_date", dateStr);
      let adjQ = db
        .from("day_end_adjustments")
        .select("id, business_date, amount, scope, notes, ledger_posted, reversed_at, branch_id")
        .eq("restaurant_id", restaurant!.id)
        .eq("business_date", dateStr)
        .is("reversed_at", null);
      let ohQ = db
        .from("daily_overhead_closures")
        .select("id, business_date, overhead_amount, status, posted_at, posting_error, branch_id")
        .eq("restaurant_id", restaurant!.id)
        .eq("business_date", dateStr);
      let expQ = db
        .from("expenses")
        .select("id, expense_date, amount, description, ledger_posted, approval_status, branch_id")
        .eq("restaurant_id", restaurant!.id)
        .eq("expense_date", dateStr)
        .is("deleted_at", null);

      if (branchKey) {
        salesQ = salesQ.eq("branch_id", branchKey);
        adjQ = adjQ.eq("branch_id", branchKey);
        ohQ = ohQ.eq("branch_id", branchKey);
        expQ = expQ.eq("branch_id", branchKey);
      }

      const [sales, adjustments, overhead, expenses] = await Promise.all([salesQ, adjQ, ohQ, expQ]);
      for (const r of [sales, adjustments, overhead, expenses]) {
        if (r.error) throw r.error;
      }

      const salesItems: DailyPostingItem[] = (sales.data || []).map((s: any) => ({
        id: s.id,
        kind: "sales" as const,
        label: `Daily sales (${s.status})`,
        amount: Number(s.total_sales || 0),
        posted: !!s.ledger_posted,
        blockedReason:
          s.status === "closed" || s.status === "approved"
            ? null
            : "Day must be closed before posting",
      }));

      const adjItems: DailyPostingItem[] = (adjustments.data || []).map((a: any) => ({
        id: a.id,
        kind: "adjustment" as const,
        label: a.notes || `Day-end adjustment (${a.scope})`,
        amount: Number(a.amount || 0),
        posted: !!a.ledger_posted,
      }));

      const ohItems: DailyPostingItem[] = (overhead.data || []).map((o: any) => ({
        id: o.id,
        kind: "overhead" as const,
        label: "Overhead / day closure",
        amount: Number(o.overhead_amount || 0),
        posted: !!o.posted_at,
        blockedReason:
          o.posted_at || o.status === "finalized" || o.status === "posted"
            ? o.posting_error || null
            : "Overhead day not finalized",
      }));

      const expItems: DailyPostingItem[] = (expenses.data || []).map((e: any) => ({
        id: e.id,
        kind: "expense" as const,
        label: e.description || "Expense",
        amount: Number(e.amount || 0),
        posted: !!e.ledger_posted,
        blockedReason: e.approval_status === "approved" ? null : "Awaiting approval",
      }));

      const build = (kind: DailyPostingKind, title: string, items: DailyPostingItem[]): DailyPostingGroup => ({
        kind,
        title,
        items,
        postedCount: items.filter((i) => i.posted).length,
        pendingCount: items.filter((i) => !i.posted).length,
        total: items.reduce((s, i) => s + i.amount, 0),
      });

      return [
        build("sales", "Sales revenue", salesItems),
        build("adjustment", "Day-end adjustments", adjItems),
        build("overhead", "Overhead", ohItems),
        build("expense", "Expenses", expItems),
      ];
    },
  });
}

async function postItem(item: DailyPostingItem, tenantId?: string | null, branchId?: string | null) {
  const db = supabase as any;
  if (item.kind === "sales") {
    await postSalesWithAi(item.id);
  } else if (item.kind === "adjustment") {
    const { error } = await db.rpc("post_day_end_adjustment_to_ledger", { p_adjustment_id: item.id });
    if (error) throw error;
  } else if (item.kind === "overhead") {
    const { error } = await db.rpc("post_daily_overhead", { p_closure_id: item.id });
    if (error) throw error;
  } else {
    const { data, error } = await db.rpc("bulk_post_expenses", {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_expense_ids: [item.id],
    });
    if (error) throw error;
    if (data && Number(data.failed || 0) > 0) {
      throw new Error(data.details?.[0]?.reason_detail || "Expense posting failed");
    }
  }
}

/** Post one pending item, or every pending item of the selected day. */
export function usePostDailyLedger(date: Date, branchId: string | null) {
  const { restaurant, profile } = useAuth();
  const qc = useQueryClient();
  const tz = restaurant?.timezone || "UTC";
  const dateStr = formatZonedYMD(date, tz);
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["daily-ledger-posting"] });
    qc.invalidateQueries({ queryKey: ["daily-profit"] });
    qc.invalidateQueries({ queryKey: ["profit-loss"] });
    qc.invalidateQueries({ queryKey: ["account-transactions"] });
    qc.invalidateQueries({ queryKey: ["trial-balance"] });
  };

  const postOne = useMutation({
    mutationFn: async (item: DailyPostingItem) => {
      await postItem(item, profile?.tenant_id, branchKey);
    },
    onSuccess: () => {
      toast.success("Posted to ledger");
      invalidate();
    },
    onError: (e: any) => toast.error("Posting failed", { description: e?.message }),
  });

  const postAll = useMutation({
    mutationFn: async (items: DailyPostingItem[]) => {
      let posted = 0;
      const failures: string[] = [];
      for (const item of items) {
        try {
          await postItem(item, profile?.tenant_id, branchKey);
          posted++;
        } catch (e: any) {
          failures.push(`${item.label}: ${e?.message || "failed"}`);
        }
      }
      return { posted, failures };
    },
    onSuccess: ({ posted, failures }) => {
      if (failures.length === 0) {
        toast.success(`${dateStr}: ${posted} entries posted to the ledger`);
      } else {
        toast.warning(`${posted} posted, ${failures.length} failed`, {
          description: failures.slice(0, 3).join(" · "),
        });
      }
      invalidate();
    },
    onError: (e: any) => toast.error("Posting failed", { description: e?.message }),
  });

  return { postOne, postAll };
}
