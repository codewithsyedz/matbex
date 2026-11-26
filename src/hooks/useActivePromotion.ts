import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";

export interface PromotionCampaign {
  id: string;
  name: string;
  badge_label: string;
  headline: string;
  subheadline: string | null;
  badge_label_ar: string | null;
  headline_ar: string | null;
  subheadline_ar: string | null;
  perks_ar: string[];
  max_slots: number;
  claimed_slots: number;
  discount_percent: number;
  locked_price_forever: boolean;
  perks: string[];
  ends_at: string | null;
  is_active: boolean;
}

export const useActivePromotion = () => {
  return useQuery({
    queryKey: ["active-promotion"],
    queryFn: async (): Promise<PromotionCampaign | null> => {
      const { data, error } = await db
        .from("promotion_campaigns")
        .select("id,name,badge_label,headline,subheadline,badge_label_ar,headline_ar,subheadline_ar,perks_ar,max_slots,claimed_slots,discount_percent,locked_price_forever,perks,ends_at,is_active")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const perks = Array.isArray(data.perks) ? (data.perks as string[]) : [];
      const perks_ar = Array.isArray((data as any).perks_ar) ? ((data as any).perks_ar as string[]) : [];
      return { ...data, perks, perks_ar } as PromotionCampaign;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
};