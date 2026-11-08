import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export interface QuotaLimits {
  users?: number;
  owner?: number;
  manager?: number;
  cashier?: number;
  menu_items?: number;
  image_uploads?: number;
  email_reminders?: number;
}

export interface TenantUsage {
  user_count: number;
  owner_count: number;
  manager_count: number;
  cashier_count: number;
  menu_item_count: number;
  image_upload_count: number;
  email_reminder_count: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  limit: number | null;
  remaining: number | null;
}

export function useQuota() {
  const { tenant, plan } = useAuth();

  // Fetch current usage
  const { data: usage, refetch: refetchUsage } = useQuery({
    queryKey: ["tenant-usage", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return null;

      const { data, error } = await db
        .from("tenant_usage")
        .select("*")
        .eq("tenant_id", tenant.id)
        .maybeSingle();

      if (error) throw error;
      return data as TenantUsage | null;
    },
    enabled: !!tenant?.id,
  });

  // Fetch active addon quota boosts
  const { data: addonBoosts } = useQuery({
    queryKey: ["tenant-addon-boosts", tenant?.id],
    queryFn: async (): Promise<Record<string, number>> => {
      if (!tenant?.id) return {};
      const { data, error } = await db
        .from("tenant_addons" as any)
        .select("addon:addons(quota_boosts)")
        .eq("tenant_id", tenant.id)
        .eq("status", "active");
      if (error) throw error;
      const totals: Record<string, number> = {};
      (data ?? []).forEach((row: any) => {
        const boosts = row?.addon?.quota_boosts;
        if (boosts && typeof boosts === "object" && !Array.isArray(boosts)) {
          for (const [k, v] of Object.entries(boosts)) {
            const n = Number(v);
            if (Number.isFinite(n)) totals[k] = (totals[k] ?? 0) + n;
          }
        }
      });
      return totals;
    },
    enabled: !!tenant?.id,
    staleTime: 60_000,
  });

  // Get plan quota limits and apply addon boosts
  const planLimits: QuotaLimits = (plan as any)?.quota_limits || {};
  const quotaLimits: QuotaLimits = { ...planLimits };
  if (addonBoosts) {
    for (const [k, boost] of Object.entries(addonBoosts)) {
      const key = k as keyof QuotaLimits;
      const base = quotaLimits[key];
      if (typeof base === "number") {
        quotaLimits[key] = base + boost;
      } else if (base === undefined) {
        quotaLimits[key] = boost;
      }
    }
  }

  // Check if a specific quota allows an action
  const checkQuota = async (
    quotaType: keyof QuotaLimits,
    increment: number = 1
  ): Promise<QuotaCheckResult> => {
    if (!tenant?.id) {
      return { allowed: true, current: 0, limit: null, remaining: null };
    }

    try {
      const { data, error } = await db.rpc("check_quota", {
        p_tenant_id: tenant.id,
        p_quota_type: quotaType,
        p_increment: increment,
      });

      if (error) throw error;
      return data as unknown as QuotaCheckResult;
    } catch (err) {
      console.error("Error checking quota:", err);
      return { allowed: true, current: 0, limit: null, remaining: null };
    }
  };

  // Increment usage (for image uploads, emails)
  const incrementUsage = async (
    quotaType: "image_uploads" | "email_reminders",
    amount: number = 1
  ): Promise<boolean> => {
    if (!tenant?.id) return false;

    try {
      const { data, error } = await db.rpc("increment_usage", {
        p_tenant_id: tenant.id,
        p_quota_type: quotaType,
        p_amount: amount,
      });

      if (error) throw error;
      refetchUsage();
      return data as boolean;
    } catch (err) {
      console.error("Error incrementing usage:", err);
      return false;
    }
  };

  // Calculate usage percentages
  const getUsagePercentage = (
    quotaType: keyof QuotaLimits
  ): number | null => {
    const limit = quotaLimits[quotaType];
    if (!limit || !usage) return null;

    const usageMap: Record<keyof QuotaLimits, keyof TenantUsage> = {
      users: "user_count",
      owner: "owner_count",
      manager: "manager_count",
      cashier: "cashier_count",
      menu_items: "menu_item_count",
      image_uploads: "image_upload_count",
      email_reminders: "email_reminder_count",
    };

    const current = usage[usageMap[quotaType]] || 0;
    return Math.min(100, Math.round((current / limit) * 100));
  };

  // Check if quota is near limit (80%+)
  const isNearLimit = (quotaType: keyof QuotaLimits): boolean => {
    const percentage = getUsagePercentage(quotaType);
    return percentage !== null && percentage >= 80;
  };

  // Check if quota is at limit
  const isAtLimit = (quotaType: keyof QuotaLimits): boolean => {
    const percentage = getUsagePercentage(quotaType);
    return percentage !== null && percentage >= 100;
  };

  return {
    usage,
    quotaLimits,
    checkQuota,
    incrementUsage,
    getUsagePercentage,
    isNearLimit,
    isAtLimit,
    refetchUsage,
  };
}
