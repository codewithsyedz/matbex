import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatZonedYMD } from "@/lib/timezone";

/** Query keys that hold menu prices on POS/menu surfaces. */
const PRICE_QUERY_KEYS = [
  ["branch-menu-prices"],
  ["pos-tablet-menu"],
  ["menu-items"],
  ["menu-categories"],
  ["branch-vat-rate"],
];

export interface MenuPriceSyncState {
  /** Server-side version counter for this branch's prices. */
  version: number | null;
  /** Restaurant-local day the currently loaded prices resolve against. */
  effectiveDate: string;
  lastSyncedAt: number | null;
  syncing: boolean;
  /** Force a resync (used by the manual Refresh action). */
  resync: () => Promise<void>;
}

/**
 * Keeps every Android POS terminal on the newest effective-dated prices.
 *
 * Three independent triggers, because any one of them can miss:
 *  1. Realtime — instant push when a price row or the version counter changes.
 *  2. Poll (60s) — catches pushes missed while the tablet was asleep/offline.
 *  3. Local-day rollover — a price row that becomes effective "tomorrow"
 *     needs a refetch at midnight restaurant time even though nothing in
 *     the database changed.
 * Plus a refresh whenever the app returns to the foreground or reconnects.
 */
export function useMenuPriceSync(branchId: string | null | undefined): MenuPriceSyncState {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const tz = (restaurant as any)?.timezone || "Asia/Riyadh";
  const restaurantId = restaurant?.id as string | undefined;

  const [version, setVersion] = useState<number | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(() => formatZonedYMD(new Date(), tz));
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const knownVersion = useRef<number | null>(null);

  const invalidate = useCallback(async () => {
    await Promise.all(
      PRICE_QUERY_KEYS.map((key) => qc.invalidateQueries({ queryKey: key })),
    );
    setLastSyncedAt(Date.now());
  }, [qc]);

  const checkVersion = useCallback(
    async (force = false) => {
      if (!restaurantId || !branchId) return;
      setSyncing(true);
      try {
        const { data } = await supabase
          .from("pos_entity_versions")
          .select("version")
          .eq("restaurant_id", restaurantId)
          .eq("entity_type", "menu_prices")
          .eq("entity_id", branchId)
          .maybeSingle();
        const next = data ? Number((data as any).version) : 0;
        setVersion(next);
        if (force || knownVersion.current === null || next !== knownVersion.current) {
          const changed = knownVersion.current !== null && next !== knownVersion.current;
          knownVersion.current = next;
          if (changed || force) await invalidate();
          else setLastSyncedAt(Date.now());
        }
      } finally {
        setSyncing(false);
      }
    },
    [restaurantId, branchId, invalidate],
  );

  // 1. Realtime push on the version counter (covers menu items + branch prices).
  useEffect(() => {
    if (!restaurantId || !branchId) return;
    const channel = supabase
      .channel(`menu-price-sync-${branchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pos_entity_versions",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (!row || row.entity_type !== "menu_prices") return;
          if (row.entity_id !== branchId && row.entity_id !== "tenant") return;
          void checkVersion(true);
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [restaurantId, branchId, checkVersion]);

  // 2. Poll every 60s + initial read.
  useEffect(() => {
    if (!restaurantId || !branchId) return;
    void checkVersion();
    const id = window.setInterval(() => void checkVersion(), 60_000);
    return () => window.clearInterval(id);
  }, [restaurantId, branchId, checkVersion]);

  // 3. Restaurant-local day rollover: future-dated prices go live at midnight.
  useEffect(() => {
    const id = window.setInterval(() => {
      const today = formatZonedYMD(new Date(), tz);
      setEffectiveDate((prev) => {
        if (prev === today) return prev;
        void invalidate();
        return today;
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [tz, invalidate]);

  // Foreground / reconnect refresh.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === "visible") void checkVersion(true);
    };
    const onOnline = () => void checkVersion(true);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onOnline);
    };
  }, [checkVersion]);

  return {
    version,
    effectiveDate,
    lastSyncedAt,
    syncing,
    resync: () => checkVersion(true),
  };
}
