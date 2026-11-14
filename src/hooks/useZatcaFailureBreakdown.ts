import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { categorizeFailure, FAILURE_BUCKET_LABEL, type FailureBucket } from "@/lib/zatca/failureBuckets";

export interface FailureBreakdownEntry {
  bucket: FailureBucket;
  label: string;
  count: number;
}

/**
 * Aggregated failure causes for the last 30 days, grouped by bucket.
 */
export function useZatcaFailureBreakdown() {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id ?? null;

  return useQuery({
    queryKey: ["zatca", "failure-breakdown-export", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<FailureBreakdownEntry[]> => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await db
        .from("sales_transactions")
        .select("id, zatca_clearance_status, zatca_clearance_response")
        .eq("restaurant_id", restaurantId!)
        .in("zatca_clearance_status", ["REJECTED", "SCHEMA_INVALID"])
        .gte("created_at", since)
        .limit(500);
      if (error) throw error;
      const counts = new Map<FailureBucket, number>();
      for (const r of (data ?? []) as Array<{
        zatca_clearance_status: string | null;
        zatca_clearance_response: unknown;
      }>) {
        const b = categorizeFailure(r.zatca_clearance_status, r.zatca_clearance_response);
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([bucket, count]) => ({
        bucket,
        label: FAILURE_BUCKET_LABEL[bucket],
        count,
      }));
    },
  });
}