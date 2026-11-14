import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Subscribes to ZATCA-relevant Postgres changes and invalidates the React Query
 * caches that power the compliance badge, failure donut, trend sparkline, and
 * audit trail. Scoped per restaurant/tenant so cross-tenant updates are ignored.
 */
export function useZatcaRealtime() {
  const qc = useQueryClient();
  const { restaurant, tenant } = useAuth();
  const restaurantId = restaurant?.id ?? null;
  const tenantId = tenant?.id ?? restaurant?.tenant_id ?? null;

  useEffect(() => {
    if (!restaurantId && !tenantId) return;

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["zatca", "compliance"] });
      qc.invalidateQueries({ queryKey: ["zatca", "failure-breakdown"] });
      qc.invalidateQueries({ queryKey: ["zatca", "failure-breakdown-export"] });
      qc.invalidateQueries({ queryKey: ["zatca", "audit-trail"] });
      qc.invalidateQueries({ queryKey: ["zatca", "chain-integrity"] });
      qc.invalidateQueries({ queryKey: ["zatca", "chain-break-detail"] });
      qc.invalidateQueries({ queryKey: ["zatca", "devices"] });
    };

    const channel = db.channel(`zatca-compliance-${tenantId ?? restaurantId}`);

    if (restaurantId) {
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sales_transactions",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        invalidate,
      );
    }

    if (tenantId) {
      channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "zatca_audit_trail",
          filter: `tenant_id=eq.${tenantId}`,
        },
        invalidate,
      );
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "zatca_devices", filter: `tenant_id=eq.${tenantId}` },
        invalidate,
      );
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "zatca_credit_notes", filter: `tenant_id=eq.${tenantId}` },
        invalidate,
      );
    }

    channel.subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [qc, restaurantId, tenantId]);
}