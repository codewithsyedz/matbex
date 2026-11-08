import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TemplateAnalytics {
  template_key: string;
  use_count: number;
  min_variance: number;
  max_variance: number;
  avg_variance: number;
  median_abs_variance: number;
  last_used_at: string | null;
  short_count: number; // variance < 0
  over_count: number; // variance > 0
}

export interface AnalyticsDateRange {
  fromISO: string;
  toISO: string;
}

export function useVarianceTemplateAnalytics(range: AnalyticsDateRange) {
  const { tenant, restaurant } = useAuth();

  return useQuery({
    queryKey: [
      "variance-template-analytics",
      tenant?.id,
      restaurant?.id,
      range.fromISO,
      range.toISO,
    ],
    queryFn: async (): Promise<Record<string, TemplateAnalytics>> => {
      if (!tenant?.id) return {};

      const { data, error } = await supabase
        .from("variance_template_usage_events")
        .select("template_key, variance_amount, abs_variance, used_at")
        .eq("tenant_id", tenant.id)
        .or(
          `restaurant_id.eq.${
            restaurant?.id ?? "00000000-0000-0000-0000-000000000000"
          },restaurant_id.is.null`
        )
        .gte("used_at", range.fromISO)
        .lte("used_at", range.toISO)
        .order("used_at", { ascending: false })
        .limit(5000);

      if (error) throw error;

      const byKey: Record<string, { variances: number[]; abs: number[]; lastUsed: string | null; short: number; over: number }> = {};
      for (const row of data ?? []) {
        const key = row.template_key as string;
        const v = Number(row.variance_amount ?? 0);
        const a = Number(row.abs_variance ?? Math.abs(v));
        if (!byKey[key]) byKey[key] = { variances: [], abs: [], lastUsed: null, short: 0, over: 0 };
        byKey[key].variances.push(v);
        byKey[key].abs.push(a);
        if (!byKey[key].lastUsed) byKey[key].lastUsed = row.used_at as string;
        if (v < 0) byKey[key].short += 1;
        else if (v > 0) byKey[key].over += 1;
      }

      const out: Record<string, TemplateAnalytics> = {};
      for (const [key, agg] of Object.entries(byKey)) {
        const sorted = [...agg.abs].sort((a, b) => a - b);
        const median =
          sorted.length === 0
            ? 0
            : sorted.length % 2 === 1
              ? sorted[(sorted.length - 1) / 2]
              : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        const sum = agg.variances.reduce((s, n) => s + n, 0);
        out[key] = {
          template_key: key,
          use_count: agg.variances.length,
          min_variance: Math.min(...agg.variances),
          max_variance: Math.max(...agg.variances),
          avg_variance: sum / agg.variances.length,
          median_abs_variance: median,
          last_used_at: agg.lastUsed,
          short_count: agg.short,
          over_count: agg.over,
        };
      }
      return out;
    },
    enabled: !!tenant?.id,
  });
}