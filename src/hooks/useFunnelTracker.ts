import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useDemoTrial } from "@/hooks/useDemoTrial";

export type FunnelEventType =
  | "first_order"
  | "first_report_view"
  | "branch_attempted"
  | "export_attempted"
  | "upgrade_clicked"
  | "activation_dialog_opened";

/**
 * Records demo conversion funnel signals. First-occurrence events are
 * dedup'd in the DB via a unique partial index; the client also caches
 * locally to avoid hammering the network.
 */
export function useFunnelTracker() {
  const { tenant, user } = useAuth();
  const { isDemo } = useDemoTrial();

  const track = useCallback(
    async (event_type: FunnelEventType, metadata: Record<string, unknown> = {}) => {
      if (!tenant?.id || !isDemo) return;
      const localKey = `matbex.funnel.${tenant.id}.${event_type}`;
      if (localStorage.getItem(localKey)) return;
      localStorage.setItem(localKey, new Date().toISOString());
      try {
        await (supabase as any)
          .from("demo_funnel_events")
          .insert({
            tenant_id: tenant.id,
            user_id: user?.id ?? null,
            event_type,
            metadata,
          });
      } catch {
        // ignore - funnel telemetry is best-effort
      }
    },
    [tenant?.id, user?.id, isDemo]
  );

  return { track };
}