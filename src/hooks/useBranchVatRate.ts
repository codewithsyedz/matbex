import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PRICES_VAT_INCLUSIVE, VAT_RATE } from "@/lib/vatInclusive";

/**
 * Per-branch VAT settings.
 * - `vat_rate` is stored as a percentage; returned as a decimal fraction
 *   (0.15 for 15%) so it can be passed straight into the vatInclusive helpers.
 * - `prices_vat_inclusive` says whether listed prices already contain VAT.
 * Falls back to the platform defaults.
 */
export function useBranchVatRate(branchId?: string | null) {
  const { data } = useQuery({
    queryKey: ["branch-vat-settings", branchId],
    queryFn: async () => {
      if (!branchId) return null;
      const { data, error } = await supabase
        .from("branches" as any)
        .select("vat_rate, prices_vat_inclusive")
        .eq("id", branchId)
        .maybeSingle();
      if (error) throw error;
      const row = data as
        | { vat_rate?: number | string; prices_vat_inclusive?: boolean | null }
        | null;
      const pct = row?.vat_rate;
      const num = typeof pct === "string" ? parseFloat(pct) : pct;
      return {
        pct: typeof num === "number" && isFinite(num) ? num : null,
        inclusive:
          typeof row?.prices_vat_inclusive === "boolean"
            ? row.prices_vat_inclusive
            : DEFAULT_PRICES_VAT_INCLUSIVE,
      };
    },
    enabled: !!branchId,
    staleTime: 5 * 60 * 1000,
  });

  const rate = data?.pct == null ? VAT_RATE : data.pct / 100;
  const pricesInclusive = data?.inclusive ?? DEFAULT_PRICES_VAT_INCLUSIVE;
  return {
    vatRate: rate,
    vatPercent: Math.round(rate * 10000) / 100,
    pricesInclusive,
  };
}
