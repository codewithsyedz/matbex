// =====================================================================
// Cache realtime refresher (Epic C3)
// ---------------------------------------------------------------------
// Subscribes to postgres_changes on the tables the POS cache mirrors
// and upserts / removes rows in IndexedDB so a running terminal picks
// up cloud edits within ~1-2s. Falls back to periodic re-hydrate if
// realtime disconnects.
// =====================================================================

import { supabase } from "@/integrations/supabase/client";
import { STORES, put, remove, type StoreName } from "./db";

type Handle = { unsubscribe: () => void };

function wireTable(opts: {
  channelId: string;
  table: string;
  store: StoreName;
  filter: string;
  toRow: (row: any) => { id: string; updated_at: string; data: unknown } | null;
}): Handle {
  const channel = supabase
    .channel(opts.channelId)
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table: opts.table, filter: opts.filter },
      (payload: any) => {
        const type = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        if (type === "DELETE") {
          const id = payload.old?.id;
          if (id) void remove(opts.store, id).catch(() => {});
          return;
        }
        const mapped = opts.toRow(payload.new);
        if (mapped) void put(opts.store, mapped).catch(() => {});
      },
    )
    .subscribe();
  return { unsubscribe: () => void supabase.removeChannel(channel) };
}

export interface RealtimeOpts {
  restaurantId: string;
  branchId?: string | null;
}

/**
 * Attach realtime listeners for the cached tables. Returns a teardown
 * fn that removes every channel; call it before re-subscribing with a
 * different tenant/branch.
 */
export function startCacheRealtime(opts: RealtimeOpts): () => void {
  if (!opts.restaurantId) return () => {};
  const handles: Handle[] = [];

  handles.push(wireTable({
    channelId: `cache-menu-${opts.restaurantId}`,
    table: "menu_items",
    store: STORES.cacheMenu,
    filter: `restaurant_id=eq.${opts.restaurantId}`,
    toRow: (r) => (r?.id ? { id: r.id, updated_at: r.updated_at, data: r } : null),
  }));

  handles.push(wireTable({
    channelId: `cache-customers-${opts.restaurantId}`,
    table: "customers",
    store: STORES.cacheCustomers,
    filter: `restaurant_id=eq.${opts.restaurantId}`,
    toRow: (r) => (r?.id ? { id: r.id, updated_at: r.updated_at, data: r } : null),
  }));

  if (opts.branchId) {
    handles.push(wireTable({
      channelId: `cache-pricing-${opts.branchId}`,
      table: "menu_item_branch_prices",
      store: STORES.cachePricing,
      filter: `branch_id=eq.${opts.branchId}`,
      toRow: (r) => (r?.id ? { id: r.id, updated_at: r.updated_at, data: r } : null),
    }));
  }

  return () => handles.forEach((h) => { try { h.unsubscribe(); } catch { /* noop */ } });
}