/**
 * Guest QR orders waiting for staff (docs/plans/open-checks.md, phase 2b.3), live: refreshed
 * when pos_table_orders changes (event channel) and every 20 seconds as a fallback. Used for
 * the "Open checks" badge on the POS and the list in the Open checks sheet.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listGuestOrders } from "@/lib/api/checks";
import { useTableChanges } from "@/hooks/useTableChanges";

export function useGuestOrders(restaurantId: string | null | undefined, branchId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const key = ["pos-guest-orders", restaurantId, branchId ?? null];
  const query = useQuery({
    queryKey: key,
    queryFn: () => listGuestOrders(restaurantId!, branchId),
    enabled: enabled && !!restaurantId,
    refetchInterval: 20_000,
    // A POS without a connection keeps showing the last list instead of an error.
    retry: false,
  });
  useTableChanges({
    topic: "pos",
    restaurantId,
    branchId,
    tables: ["pos_table_orders"],
    enabled: enabled && !!restaurantId,
    onChange: () => void qc.invalidateQueries({ queryKey: ["pos-guest-orders", restaurantId] }),
  });
  return query;
}
