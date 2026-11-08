import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TemplateUsage {
  template_key: string;
  use_count: number;
  last_used_at: string;
}

export function useVarianceTemplateUsage() {
  const { tenant, restaurant } = useAuth();
  const qc = useQueryClient();

  const { data: usage } = useQuery({
    queryKey: ["variance-template-usage", tenant?.id, restaurant?.id],
    queryFn: async (): Promise<Record<string, TemplateUsage>> => {
      if (!tenant?.id) return {};
      const { data, error } = await db
        .from("variance_template_usage")
        .select("template_key, use_count, last_used_at, restaurant_id")
        .eq("tenant_id", tenant.id)
        .or(
          `restaurant_id.eq.${
            restaurant?.id ?? "00000000-0000-0000-0000-000000000000"
          },restaurant_id.is.null`
        );
      if (error) throw error;
      const map: Record<string, TemplateUsage> = {};
      for (const row of data ?? []) {
        const existing = map[row.template_key];
        // Prefer restaurant-specific over null
        if (
          !existing ||
          (row as { restaurant_id: string | null }).restaurant_id ===
            (restaurant?.id ?? null)
        ) {
          map[row.template_key] = {
            template_key: row.template_key,
            use_count: row.use_count,
            last_used_at: row.last_used_at,
          };
        }
      }
      return map;
    },
    enabled: !!tenant?.id,
  });

  const recordUsage = useMutation({
    mutationFn: async ({
      templateKey,
      varianceAmount,
      dailySalesId,
      businessDate,
      notesSnapshot,
    }: {
      templateKey: string;
      varianceAmount: number;
      dailySalesId?: string | null;
      businessDate?: string | null;
      notesSnapshot?: string | null;
    }) => {
      if (!tenant?.id) return;
      const { error } = await db.rpc("increment_variance_template_usage", {
        _template_key: templateKey,
        _restaurant_id: restaurant?.id ?? null,
        _variance_amount: varianceAmount,
        _daily_sales_id: dailySalesId ?? null,
        _business_date: businessDate ?? null,
        _notes_snapshot: notesSnapshot ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variance-template-usage"] });
      qc.invalidateQueries({ queryKey: ["variance-template-analytics"] });
    },
  });

  const getCount = (key: string) => usage?.[key]?.use_count ?? 0;

  return { usage: usage ?? {}, recordUsage, getCount };
}