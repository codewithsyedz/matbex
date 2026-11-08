import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type PlanTierName = "trial" | "free" | "pro" | "enterprise";

const PLAN_RANK: Record<string, number> = {
  trial: 0,
  free: 1,
  pro: 2,
  enterprise: 3,
};

/** True when the tenant's plan satisfies the flag's min_plan gate. */
function meetsPlanGate(minPlan: string | null | undefined, planName: string | null | undefined): boolean {
  if (!minPlan) return true;
  const required = PLAN_RANK[minPlan.toLowerCase()] ?? 0;
  const current = PLAN_RANK[(planName ?? "").toLowerCase()] ?? -1;
  return current >= required;
}

export interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
  rollout_tenant_ids: string[];
  disabled_tenant_ids: string[];
  min_plan: string | null;
  updated_at: string;
}

let cachedFlags: FeatureFlag[] | null = null;
const subscribers = new Set<(flags: FeatureFlag[]) => void>();
let channelInitialized = false;
let activeTenantId: string | null = null;

function notify(flags: FeatureFlag[]) {
  cachedFlags = flags;
  subscribers.forEach((cb) => cb(flags));
}

async function fetchFlags() {
  // Try direct table read first — succeeds only for SuperAdmins. Regular
  // users hit RLS and get an empty array, so we fall back to the per-tenant
  // RPC which returns only resolved {key, enabled} entries.
  const { data: direct, error: directErr } = await supabase
    .from("feature_flags")
    .select("*")
    .order("key");
  if (!directErr && direct && direct.length > 0) {
    notify(direct as FeatureFlag[]);
    return;
  }
  if (!activeTenantId) {
    notify([]);
    return;
  }
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "get_feature_flags_for_tenant",
    { _tenant_id: activeTenantId }
  );
  if (rpcErr) {
    console.error("[feature-flags] rpc fetch failed", rpcErr);
    return;
  }
  const nowIso = new Date().toISOString();
  const simplified: FeatureFlag[] = (rpcData ?? []).map((r: { flag_key: string; is_enabled: boolean }) => ({
    id: r.flag_key,
    key: r.flag_key,
    enabled: !!r.is_enabled,
    description: null,
    rollout_tenant_ids: [],
    disabled_tenant_ids: [],
    min_plan: null,
    updated_at: nowIso,
  }));
  notify(simplified);
}

/** Called by the AuthCore effect so module-level fetches know which tenant
 *  to ask the RPC about. Re-fetches when the tenant changes. */
export function setFeatureFlagsTenant(tenantId: string | null) {
  if (activeTenantId === tenantId) return;
  activeTenantId = tenantId;
  if (channelInitialized) void fetchFlags();
}

function ensureChannel() {
  if (channelInitialized) return;
  channelInitialized = true;
  void fetchFlags();
  // Only open a realtime WebSocket for authenticated sessions. Public/marketing
  // pages (e.g. matbex.com landing) must not open WS connections — they cause
  // noisy console errors for visitors behind restrictive networks/DNS.
  void supabase.auth.getSession().then(({ data }) => {
    if (!data.session) return;
    supabase
      .channel("feature-flags-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feature_flags" },
        () => {
          void fetchFlags();
        }
      )
      .subscribe();
  });
}

/**
 * Subscribes to remote feature flags. Returns the live list of flags.
 * Updates propagate in real time via Supabase Realtime.
 */
export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlag[]>(cachedFlags ?? []);
  const { tenant } = useAuth();

  useEffect(() => {
    setFeatureFlagsTenant(tenant?.id ?? null);
  }, [tenant?.id]);

  useEffect(() => {
    ensureChannel();
    const cb = (next: FeatureFlag[]) => setFlags(next);
    subscribers.add(cb);
    if (cachedFlags) setFlags(cachedFlags);
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  return flags;
}

/**
 * Returns whether a remote flag is enabled for the current tenant.
 * Resolution order: disabled_tenant_ids overrides global; rollout_tenant_ids
 * forces enable even if global is off; otherwise the global `enabled` value.
 * If the flag does not exist in the table, defaults to `defaultValue` (false).
 */
export function useFeatureFlag(key: string, defaultValue = false): boolean {
  const flags = useFeatureFlags();
  const { tenant, plan } = useAuth();

  return useMemo(() => {
    const flag = flags.find((f) => f.key === key);
    if (!flag) return defaultValue;
    const tid = tenant?.id;
    if (tid && flag.disabled_tenant_ids?.includes(tid)) return false;
    // Plan-tier entitlement gate (paid features). Rollout override still wins.
    if (!meetsPlanGate(flag.min_plan, plan?.name)) {
      if (tid && flag.rollout_tenant_ids?.includes(tid)) return true;
      return false;
    }
    if (tid && flag.rollout_tenant_ids?.includes(tid)) return true;
    return flag.enabled;
  }, [flags, key, tenant?.id, plan?.name, defaultValue]);
}

/**
 * Non-hook variant for use inside contexts/effects (e.g. AuthContext) where
 * calling `useAuth` would create a circular dependency. Reads from the shared
 * realtime cache populated by ensureChannel(); defaults conservatively when
 * the cache is cold so we never accidentally block a feature pre-fetch.
 * Pass the active tenantId explicitly so per-tenant overrides apply.
 */
export function isFeatureFlagEnabled(
  key: string,
  tenantId?: string | null,
  defaultValue = true
): boolean {
  // Lazy-init the channel so the very first caller still triggers a fetch.
  ensureChannel();
  const flags = cachedFlags;
  if (!flags) return defaultValue;
  const flag = flags.find((f) => f.key === key);
  if (!flag) return defaultValue;
  if (tenantId && flag.disabled_tenant_ids?.includes(tenantId)) return false;
  if (tenantId && flag.rollout_tenant_ids?.includes(tenantId)) return true;
  return flag.enabled;
}

export function useFeatureFlagAdmin() {
  const flags = useFeatureFlags();

  const upsert = useCallback(
    async (input: {
      key: string;
      enabled: boolean;
      description?: string | null;
      rollout_tenant_ids?: string[];
      disabled_tenant_ids?: string[];
      min_plan?: string | null;
    }) => {
      const { error } = await supabase.from("feature_flags").upsert(
        {
          key: input.key,
          enabled: input.enabled,
          description: input.description ?? null,
          rollout_tenant_ids: input.rollout_tenant_ids ?? [],
          disabled_tenant_ids: input.disabled_tenant_ids ?? [],
          min_plan: input.min_plan ?? null,
        },
        { onConflict: "key" }
      );
      if (error) throw error;
    },
    []
  );

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    const { error } = await supabase
      .from("feature_flags")
      .update({ enabled })
      .eq("id", id);
    if (error) throw error;
  }, []);

  const setMinPlan = useCallback(async (id: string, min_plan: string | null) => {
    const { error } = await supabase
      .from("feature_flags")
      .update({ min_plan })
      .eq("id", id);
    if (error) throw error;
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("feature_flags").delete().eq("id", id);
    if (error) throw error;
  }, []);

  return { flags, upsert, toggle, setMinPlan, remove };
}