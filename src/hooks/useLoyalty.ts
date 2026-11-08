import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type LoyaltyTier = "bronze" | "silver" | "gold";

export interface LoyaltySettings {
  id: string;
  restaurant_id: string;
  enabled: boolean;
  earn_rate_points_per_currency: number;
  redemption_points_per_unit: number;
  redemption_value_per_unit: number;
  min_redeem_points: number;
  max_redeem_pct: number;
  tier_silver_threshold: number;
  tier_gold_threshold: number;
  tier_silver_multiplier: number;
  tier_gold_multiplier: number;
  expiry_months: number;
}

export interface LoyaltyTransaction {
  id: string;
  restaurant_id: string;
  customer_id: string;
  kind: "earn" | "redeem" | "adjust" | "expire";
  points: number;
  currency_value: number;
  sales_transaction_id: string | null;
  note: string | null;
  created_at: string;
}

const DEFAULTS: Omit<LoyaltySettings, "id" | "restaurant_id"> = {
  enabled: true,
  earn_rate_points_per_currency: 1,
  redemption_points_per_unit: 100,
  redemption_value_per_unit: 5,
  min_redeem_points: 100,
  max_redeem_pct: 50,
  tier_silver_threshold: 1000,
  tier_gold_threshold: 5000,
  tier_silver_multiplier: 1.25,
  tier_gold_multiplier: 1.5,
  expiry_months: 12,
};

export function useLoyaltySettings() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id;

  const query = useQuery({
    queryKey: ["loyalty-settings", restaurantId],
    enabled: !!restaurantId,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<LoyaltySettings> => {
      const { data, error } = await supabase
        .from("loyalty_settings" as any)
        .select("*")
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as unknown as LoyaltySettings;
      // seed defaults
      const { data: created, error: insErr } = await supabase
        .from("loyalty_settings" as any)
        .insert({ restaurant_id: restaurantId!, ...DEFAULTS } as any)
        .select()
        .single();
      if (insErr) throw insErr;
      return created as unknown as LoyaltySettings;
    },
  });

  const update = useMutation({
    mutationFn: async (patch: Partial<LoyaltySettings>) => {
      if (!restaurantId) throw new Error("No restaurant");
      const { error } = await supabase
        .from("loyalty_settings" as any)
        .update(patch as any)
        .eq("restaurant_id", restaurantId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loyalty-settings", restaurantId] });
      toast.success("Loyalty rules saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { ...query, update };
}

export function useCustomerLoyalty(customerId?: string) {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id;

  const transactions = useQuery({
    queryKey: ["loyalty-tx", customerId],
    enabled: !!customerId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loyalty_transactions" as any)
        .select("*")
        .eq("customer_id", customerId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as LoyaltyTransaction[];
    },
  });

  const post = useMutation({
    mutationFn: async (input: {
      customer_id: string;
      kind: LoyaltyTransaction["kind"];
      points: number;
      currency_value?: number;
      sales_transaction_id?: string | null;
      note?: string;
    }) => {
      if (!restaurantId) throw new Error("No restaurant");
      const { error } = await supabase.from("loyalty_transactions" as any).insert({
        restaurant_id: restaurantId,
        customer_id: input.customer_id,
        kind: input.kind,
        points: input.points,
        currency_value: input.currency_value ?? 0,
        sales_transaction_id: input.sales_transaction_id ?? null,
        note: input.note ?? null,
      } as any);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["loyalty-tx", vars.customer_id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { transactions, post };
}

export function calcEarnedPoints(
  amount: number,
  settings: LoyaltySettings | undefined,
  tier: LoyaltyTier = "bronze",
): number {
  if (!settings || !settings.enabled || amount <= 0) return 0;
  const base = amount * settings.earn_rate_points_per_currency;
  const mult =
    tier === "gold"
      ? settings.tier_gold_multiplier
      : tier === "silver"
      ? settings.tier_silver_multiplier
      : 1;
  return Math.floor(base * mult);
}

export function calcRedemptionValue(points: number, settings?: LoyaltySettings) {
  if (!settings || points <= 0 || settings.redemption_points_per_unit <= 0) return 0;
  const units = Math.floor(points / settings.redemption_points_per_unit);
  return units * settings.redemption_value_per_unit;
}