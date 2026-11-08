import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  normaliseMonitorStats,
  type SalePostingMonitorStats,
} from "@/lib/salePostingMonitor";

export interface SalePostingFailureRow {
  id: string;
  branch_id: string | null;
  business_date: string;
  shift_id: string | null;
  source: string;
  error_code: string | null;
  error_message: string;
  context: Record<string, unknown> | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface ReplayRow {
  idempotency_key: string;
  terminal_uid: string;
  entity_type: string;
  shift_id: string | null;
  replay_count: number;
  last_replay_at: string | null;
  created_at: string;
}

interface Params {
  from: string; // yyyy-MM-dd
  to: string;
  branchId?: string | null;
}

export function useSalePostingMonitor({ from, to, branchId }: Params) {
  const { restaurant } = useAuth();
  const queryClient = useQueryClient();
  const restaurantId = restaurant?.id;

  const stats = useQuery<SalePostingMonitorStats>({
    queryKey: ["sale-posting-monitor", restaurantId, from, to, branchId ?? null],
    enabled: !!restaurantId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sale_posting_monitor" as never, {
        _restaurant_id: restaurantId,
        _from: from,
        _to: to,
        _branch_id: branchId ?? null,
      } as never);
      if (error) throw error;
      return normaliseMonitorStats(data);
    },
  });

  const failures = useQuery<SalePostingFailureRow[]>({
    queryKey: ["sale-posting-failures", restaurantId, from, to, branchId ?? null],
    enabled: !!restaurantId,
    queryFn: async () => {
      let q = supabase
        .from("sale_posting_failures" as never)
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("business_date", from)
        .lte("business_date", to)
        .order("created_at", { ascending: false })
        .limit(500);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as SalePostingFailureRow[];
    },
  });

  const replays = useQuery<ReplayRow[]>({
    queryKey: ["sale-posting-replays", restaurantId, from, to],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_idempotency_keys")
        .select("idempotency_key, terminal_uid, entity_type, shift_id, replay_count, last_replay_at, created_at" as never)
        .eq("restaurant_id", restaurantId)
        .gt("replay_count", 0)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .order("last_replay_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ReplayRow[];
    },
  });

  const resolve = useMutation({
    mutationFn: async (failureId: string) => {
      const { error } = await supabase.rpc("resolve_sale_posting_failure" as never, {
        _failure_id: failureId,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Failure marked as resolved");
      queryClient.invalidateQueries({ queryKey: ["sale-posting-failures"] });
      queryClient.invalidateQueries({ queryKey: ["sale-posting-monitor"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not resolve failure"),
  });

  return {
    stats: stats.data,
    failures: failures.data ?? [],
    replays: replays.data ?? [],
    isLoading: stats.isLoading || failures.isLoading || replays.isLoading,
    isFetching: stats.isFetching || failures.isFetching || replays.isFetching,
    refetch: () => {
      stats.refetch();
      failures.refetch();
      replays.refetch();
    },
    resolve,
  };
}
