import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Untyped client helper for the daily-overhead tables/RPCs. */
const db = supabase as any;

export type DailyOverheadStatus =
  | "draft"
  | "finalized"
  | "posted"
  | "posting_failed"
  | "adjusted"
  | "reopened";

export interface DailyOverheadClosure {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  branch_id: string | null;
  business_date: string;
  overhead_amount: number;
  original_amount: number | null;
  breakdown: Record<string, unknown> | null;
  status: DailyOverheadStatus;
  gl_reference: string;
  batch_id: string | null;
  posted_at: string | null;
  posting_error: string | null;
  finalized_by: string | null;
  finalized_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  created_at: string;
}

export interface DailyOverheadAuditRow {
  id: string;
  closure_id: string;
  business_date: string;
  action: string;
  amount_before: number | null;
  amount_after: number | null;
  batch_id: string | null;
  gl_reference: string | null;
  reason: string | null;
  error_message: string | null;
  performed_by: string | null;
  performed_at: string;
}

interface Args {
  /** null / "all" = tenant-wide (no branch scope). */
  branchId?: string | null;
  businessDate: string;
  /** Period for the reporting table (inclusive). */
  periodStart: string;
  periodEnd: string;
}

export function useDailyOverhead({ branchId, businessDate, periodStart, periodEnd }: Args) {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id;
  const qc = useQueryClient();
  const scope = branchId && branchId !== "all" ? branchId : null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["daily-overhead"] });
    qc.invalidateQueries({ queryKey: ["shared-overhead-data"] });
  };

  /** Closure for the selected business date (may not exist yet = draft). */
  const closure = useQuery({
    queryKey: ["daily-overhead", "closure", restaurantId, scope, businessDate],
    enabled: !!restaurantId && !!businessDate,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<DailyOverheadClosure | null> => {
      let q = db
        .from("daily_overhead_closures")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("business_date", businessDate);
      q = scope ? q.eq("branch_id", scope) : q.is("branch_id", null);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data as DailyOverheadClosure | null;
    },
  });

  /** All closures inside the reporting period. */
  const period = useQuery({
    queryKey: ["daily-overhead", "period", restaurantId, scope, periodStart, periodEnd],
    enabled: !!restaurantId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<DailyOverheadClosure[]> => {
      let q = db
        .from("daily_overhead_closures")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("business_date", periodStart)
        .lte("business_date", periodEnd)
        .order("business_date", { ascending: false });
      q = scope ? q.eq("branch_id", scope) : q.is("branch_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as DailyOverheadClosure[];
    },
  });

  /** Audit trail for the selected day. */
  const audit = useQuery({
    queryKey: ["daily-overhead", "audit", closure.data?.id],
    enabled: !!closure.data?.id,
    queryFn: async (): Promise<DailyOverheadAuditRow[]> => {
      const { data, error } = await db
        .from("daily_overhead_audit")
        .select("*")
        .eq("closure_id", closure.data!.id)
        .order("performed_at", { ascending: false });
      if (error) throw error;
      return (data || []) as DailyOverheadAuditRow[];
    },
  });

  /** Finalize + auto-post in a single, idempotent call. */
  const finalizeDay = useMutation({
    mutationFn: async (input: { amount: number; breakdown?: Record<string, unknown> }) => {
      const { data, error } = await db.rpc("close_business_day_overhead", {
        p_restaurant_id: restaurantId,
        p_business_date: businessDate,
        p_amount: input.amount,
        p_branch_id: scope,
        p_breakdown: input.breakdown ?? {},
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  /** Idempotent retry of a failed GL posting. */
  const retryPosting = useMutation({
    mutationFn: async (closureId: string) => {
      // Wrapper RPC: never rolls back, so the failure notification is persisted.
      const { data, error } = await db.rpc("retry_daily_overhead_posting", {
        p_closure_id: closureId,
      });
      if (error) throw error;
      const result = (data ?? {}) as { success?: boolean; batch_id?: string; error?: string };
      if (!result.success) throw new Error(result.error || "Posting failed");
      return result.batch_id as string;
    },
    onSuccess: invalidate,
    onError: invalidate,
  });

  const reopenDay = useMutation({
    mutationFn: async (input: { closureId: string; reason: string }) => {
      const { error } = await db.rpc("reopen_daily_overhead", {
        p_closure_id: input.closureId,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const adjustDay = useMutation({
    mutationFn: async (input: { closureId: string; newAmount: number; reason: string }) => {
      const { data, error } = await db.rpc("adjust_daily_overhead", {
        p_closure_id: input.closureId,
        p_new_amount: input.newAmount,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  return { closure, period, audit, finalizeDay, retryPosting, reopenDay, adjustDay };
}
