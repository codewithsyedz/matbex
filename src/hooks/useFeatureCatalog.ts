import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";

export interface FeatureDef { key: string; label: string; description: string | null; category: string }

/**
 * The feature catalogue (public.platform_features): every key a plan, add-on or override can
 * switch, with its label and group. The one list behind the plan editor, add-on form, business
 * toggles and the feature map; tenant_entitlements() uses the same keys.
 */
export function useFeatureCatalog(): FeatureDef[] {
  const q = useQuery({
    queryKey: ["feature-catalog"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("platform_features").select("key, label, description, category").order("sort_order");
      if (error) throw error;
      return (data ?? []) as FeatureDef[];
    },
  });
  return q.data ?? [];
}
