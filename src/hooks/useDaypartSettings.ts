import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query/queryKeys";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface DaypartConfig {
  morning_start: number;
  noon_start: number;
  evening_start: number;
  late_night_start: number;
}

export const DEFAULT_DAYPARTS: DaypartConfig = {
  morning_start: 6,
  noon_start: 12,
  evening_start: 17,
  late_night_start: 22,
};

export type DayPart = "Morning" | "Noon" | "Evening" | "Late Night";

export function getDaypartFor(hour: number, cfg: DaypartConfig): DayPart {
  // Late Night wraps past midnight back to morning_start
  if (hour >= cfg.morning_start && hour < cfg.noon_start) return "Morning";
  if (hour >= cfg.noon_start && hour < cfg.evening_start) return "Noon";
  if (hour >= cfg.evening_start && hour < cfg.late_night_start) return "Evening";
  return "Late Night";
}

export function formatHour12(h: number) {
  const suf = h >= 12 ? "PM" : "AM";
  const d = h % 12 === 0 ? 12 : h % 12;
  return `${d}${suf}`;
}

export function useDaypartSettings() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["daypart-settings", restaurant?.id],
    enabled: !!restaurant?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daypart_settings")
        .select("morning_start, noon_start, evening_start, late_night_start")
        .eq("restaurant_id", restaurant!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as DaypartConfig) ?? DEFAULT_DAYPARTS;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (cfg: DaypartConfig) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { data, error } = await supabase
        .from("daypart_settings")
        .upsert({ restaurant_id: restaurant.id, ...cfg }, { onConflict: "restaurant_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daypart-settings"] });
      qc.invalidateQueries({ queryKey: qk.salesTrends.all() });
    },
  });

  return {
    config: data ?? DEFAULT_DAYPARTS,
    isLoading,
    update: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
