import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { STORES, getAll, put } from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/connectivity";
import { useAuth } from "@/contexts/AuthContext";
import { formatZonedYMD } from "@/lib/timezone";
import { useTableChanges } from "@/hooks/useTableChanges";

export interface BranchPriceRow {
  menu_item_id: string;
  quarter_price: number | null;
  half_price: number | null;
  full_price: number | null;
  cost_override: number | null;
  effective_from: string;
  effective_to: string | null;
}

/**
 * Fetch the price row active at `date` for every menu item at the given
 * branch. Returns a map keyed by menu_item_id. When branchId is null the
 * hook is disabled and returns an empty map.
 */
export function useBranchPrices(branchId: string | null | undefined, date?: string) {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const tz = (restaurant as any)?.timezone || "Asia/Riyadh";
  // Use the restaurant-local calendar day, not UTC — otherwise a price that
  // becomes effective "today" locally looks like a future row after 21:00 UTC.
  const day = date || formatZonedYMD(new Date(), tz);
  const query = useQuery({
    queryKey: ["branch-menu-prices", branchId, day],
    queryFn: async () => {
      if (!branchId) return {} as Record<string, BranchPriceRow>;

      const fromCache = async (): Promise<Record<string, BranchPriceRow>> => {
        try {
          const rows = await getAll<{ id: string; scope?: string; data: any }>(
            STORES.cachePricing,
          );
          const map: Record<string, BranchPriceRow> = {};
          rows
            .filter((r) => !r.scope || r.scope === branchId)
            .map((r) => r.data as any)
            .filter((r) => {
              if (!r) return false;
              if (r.effective_from && r.effective_from > day) return false;
              if (r.effective_to && r.effective_to < day) return false;
              return true;
            })
            .forEach((r) => { map[r.menu_item_id] = r as BranchPriceRow; });
          return map;
        } catch {
          return {};
        }
      };

      if (!isOnline()) return fromCache();

      const { data, error } = await db.rpc("get_branch_menu_prices", {
        _branch_id: branchId,
        _at: day,
      });
      if (error) return fromCache();
      const map: Record<string, BranchPriceRow> = {};
      ((data as BranchPriceRow[]) || []).forEach((r) => {
        map[r.menu_item_id] = r;
        // Write-through: composite id keeps different branches isolated.
        void put(STORES.cachePricing, {
          id: `${branchId}:${r.menu_item_id}`,
          scope: branchId,
          updated_at: new Date().toISOString(),
          data: r,
        }).catch(() => {});
      });
      return map;
    },
    enabled: !!branchId,
    staleTime: 60_000,
    refetchOnMount: "always",
  });

  // Live-update prices: any change to this branch's override rows immediately
  // refreshes the Menu/POS price map without a manual reload.
  // Live-update prices: any change to this branch's override rows refreshes the Menu/POS
  // price map (event channel, topic "pos").
  useTableChanges({
    topic: "pos",
    restaurantId: restaurant?.id,
    tables: ["menu_item_branch_prices"],
    enabled: !!branchId,
    filter: (c) => c.branch_id === branchId,
    onChange: () => qc.invalidateQueries({ queryKey: ["branch-menu-prices", branchId] }),
  });

  return { priceMap: query.data || {}, isLoading: query.isLoading, refetch: query.refetch };
}

export interface PriceableItem {
  id: string;
  selling_price: number;
  quarter_price: number;
  half_price: number;
  full_price: number;
}

/**
 * Return `items` with per-branch price overrides applied. If an override
 * row lacks a specific tier, the base price is kept (fall-back rule).
 */
export function applyBranchPrices<T extends PriceableItem>(
  items: T[],
  priceMap: Record<string, BranchPriceRow>
): T[] {
  if (!items?.length || !Object.keys(priceMap).length) return items;
  return items.map((it) => {
    const p = priceMap[it.id];
    if (!p) return it;
    const qp = p.quarter_price != null ? Number(p.quarter_price) : it.quarter_price;
    const hp = p.half_price != null ? Number(p.half_price) : it.half_price;
    const fp = p.full_price != null ? Number(p.full_price) : it.full_price;
    const sp = p.full_price != null ? Number(p.full_price) : it.selling_price;
    return { ...it, quarter_price: qp, half_price: hp, full_price: fp, selling_price: sp };
  });
}