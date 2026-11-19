// =====================================================================
// Cache hydrator (Epic C2)
// ---------------------------------------------------------------------
// Pulls source-of-truth rows from the API into IndexedDB so the POS can
// render fully offline. Delta-based: each cache tracks its own
// `kv['cache.<name>.since']` watermark and only fetches rows updated
// after it. First run is a full pull.
//
// Kept intentionally small - only the tables the POS actually reads at
// runtime (menu / pricing / customers / receipt templates + tax/ZATCA
// config). Everything else stays server-side.
// =====================================================================

import { db } from "@/integrations/db/client";
import { STORES, put, kvGet, kvSet, type StoreName } from "./db";
import { isOnline } from "./connectivity";

type CacheRow = { id: string; updated_at: string; data: unknown; scope?: string | null };

async function upsertRows(store: StoreName, rows: CacheRow[]) {
  for (const r of rows) await put(store, r);
}

function watermarkKey(name: string) {
  return `cache.${name}.since`;
}

async function pullDelta<T extends Record<string, any>>(opts: {
  cacheName: string;
  store: StoreName;
  table: string;
  select: string;
  restaurantId: string;
  extraFilter?: (q: any) => any;
  toRow: (row: T) => CacheRow;
}) {
  const sinceKey = watermarkKey(opts.cacheName);
  const since = ((await kvGet<string>(sinceKey)) as string) || "1970-01-01T00:00:00Z";
  let q = db.from(opts.table as any)
    .select(opts.select)
    .eq("restaurant_id", opts.restaurantId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(500);
  if (opts.extraFilter) q = opts.extraFilter(q);
  const { data, error } = await q;
  if (error) throw error;
  const rows = ((data as unknown) as T[]) || [];
  if (rows.length === 0) return 0;
  await upsertRows(opts.store, rows.map(opts.toRow));
  const latest = rows.reduce(
    (max, r) => (String(r.updated_at) > max ? String(r.updated_at) : max),
    since,
  );
  await kvSet(sinceKey, latest);
  return rows.length;
}

export interface HydrateOpts {
  restaurantId: string;
  branchId?: string | null;
}

export interface HydrateResult {
  menu: number;
  pricing: number;
  customers: number;
  receiptTemplates: number;
}

/**
 * Pull deltas for every cached table. No-op when offline. Safe to call
 * repeatedly - each cache advances its own watermark. Failures on one
 * cache do not block the others.
 */
export async function hydrateAllCaches(opts: HydrateOpts): Promise<HydrateResult> {
  const result: HydrateResult = { menu: 0, pricing: 0, customers: 0, receiptTemplates: 0 };
  if (!isOnline() || !opts.restaurantId) return result;

  const tasks = [
    pullDelta({
      cacheName: "menu",
      store: STORES.cacheMenu,
      table: "menu_items",
      select: "id, name, category, selling_price, quarter_price, half_price, full_price, is_active, image_url, updated_at",
      restaurantId: opts.restaurantId,
      toRow: (r: any) => ({ id: r.id, updated_at: r.updated_at, data: r }),
    }).then((n) => { result.menu = n; }).catch(() => {}),

    pullDelta({
      cacheName: "customers",
      store: STORES.cacheCustomers,
      table: "customers",
      select: "id, name, phone, email, credit_balance, updated_at",
      restaurantId: opts.restaurantId,
      toRow: (r: any) => ({ id: r.id, updated_at: r.updated_at, data: r }),
    }).then((n) => { result.customers = n; }).catch(() => {}),

    pullDelta({
      cacheName: "receipt_templates",
      store: STORES.cacheReceiptTemplates,
      table: "receipt_templates",
      select: "*",
      restaurantId: opts.restaurantId,
      toRow: (r: any) => ({ id: r.id, updated_at: r.updated_at, data: r }),
    }).then((n) => { result.receiptTemplates = n; }).catch(() => {}),
  ];

  // Pricing is branch-scoped. Only hydrate when we know the active branch.
  if (opts.branchId) {
    tasks.push(
      pullDelta({
        cacheName: `pricing.${opts.branchId}`,
        store: STORES.cachePricing,
        table: "menu_item_branch_prices",
        select: "id, menu_item_id, branch_id, quarter_price, half_price, full_price, cost_override, effective_from, effective_to, updated_at",
        restaurantId: opts.restaurantId,
        extraFilter: (q: any) => q.eq("branch_id", opts.branchId),
        toRow: (r: any) => ({ id: r.id, updated_at: r.updated_at, scope: r.branch_id, data: r }),
      }).then((n) => { result.pricing = n; }).catch(() => {}),
    );
  }

  await Promise.all(tasks);
  return result;
}

/** Reset every cache watermark - forces a full re-pull on next hydrate. */
export async function resetCacheWatermarks() {
  for (const name of ["menu", "customers", "receipt_templates", "pricing"]) {
    await kvSet(watermarkKey(name), "1970-01-01T00:00:00Z");
  }
}