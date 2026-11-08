import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/auth/TenantContext";
import { useImpersonation } from "@/contexts/auth/ImpersonationContext";
import { clearPersistedQueryCache } from "@/lib/queryPersist";

/**
 * Clears the React Query cache whenever the effective tenant changes
 * (real tenant switch OR start/stop of role/tenant impersonation).
 *
 * Why: React Query keys across the app rarely include tenant_id, so a
 * tenant switch could otherwise surface ~staleTime (2 min) of stale
 * cross-tenant data in the UI. Clearing on transition is the cheapest
 * way to guarantee no cross-tenant bleed.
 *
 * No-op on first mount (only fires on actual transitions).
 */
export function TenantQueryInvalidator() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { impersonatedTenantId } = useImpersonation();

  const effectiveTenantId = impersonatedTenantId ?? tenant?.id ?? null;
  const previousRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (previousRef.current === undefined) {
      previousRef.current = effectiveTenantId;
      return;
    }
    if (previousRef.current !== effectiveTenantId) {
      // Skip the initial hydration transition (null -> real id). That's not a
      // tenant *switch*, it's just auth finishing — clearing the cache here
      // forces every query in the app to refetch and makes the UI flash from
      // data → skeleton → data, which users perceive as "the page refreshed".
      const isHydration = previousRef.current === null && effectiveTenantId !== null;
      if (!isHydration) {
        queryClient.clear();
        // Drop the persisted (sessionStorage) copy too, otherwise the previous
        // tenant's dashboard aggregates could be rehydrated after a reload.
        clearPersistedQueryCache();
      }
      previousRef.current = effectiveTenantId;
    }
  }, [effectiveTenantId, queryClient]);

  return null;
}