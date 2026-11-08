import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AddonBillingType = "recurring" | "one_time";
export type TenantAddonStatus = "active" | "pending" | "cancelled" | "expired";
export type TenantAddonSource = "purchase" | "manual_grant";

export interface Addon {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  price: number;
  currency: string;
  billing_type: AddonBillingType;
  stripe_price_id: string | null;
  included_features: string[];
  quota_boosts: Record<string, number>;
  is_active: boolean;
  sort_order: number;
}

export interface TenantAddon {
  id: string;
  tenant_id: string;
  addon_id: string;
  status: TenantAddonStatus;
  source: TenantAddonSource;
  granted_by: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  activated_at: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  created_at: string;
  addon?: Addon;
}

function normalizeAddon(row: any): Addon {
  return {
    ...row,
    included_features: Array.isArray(row.included_features) ? row.included_features : [],
    quota_boosts:
      row.quota_boosts && typeof row.quota_boosts === "object" && !Array.isArray(row.quota_boosts)
        ? row.quota_boosts
        : {},
  };
}

export function useAddonCatalog(opts: { includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: ["addons-catalog", opts.includeInactive ?? false],
    queryFn: async () => {
      let q = supabase.from("addons" as any).select("*").order("sort_order").order("price");
      if (!opts.includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map(normalizeAddon);
    },
  });
}

export function useTenantAddons(tenantId?: string | null) {
  return useQuery({
    queryKey: ["tenant-addons", tenantId],
    queryFn: async (): Promise<TenantAddon[]> => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("tenant_addons" as any)
        .select("*, addon:addons(*)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        addon: r.addon ? normalizeAddon(r.addon) : undefined,
      }));
    },
    enabled: !!tenantId,
  });
}

export function useMyTenantAddons() {
  const { tenant } = useAuth();
  return useTenantAddons(tenant?.id);
}
