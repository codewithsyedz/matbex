/**
 * Data access for POS sales. Every query is scoped by restaurant_id: modules run as the table
 * owner (see modules/shared/db.ts), so RLS is not the safety net here.
 */
import { and, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import type { ServiceTx } from "../shared/db.js";
import {
  branches,
  cashEvents,
  customers,
  menuItems,
  posIdempotencyKeys,
  salesItems,
  salesTransactions,
  shifts,
} from "../../db/generated/schema.js";

export function salesRepository({ db, tx }: ServiceTx) {
  return {
    /** Branch VAT settings; falls back to the restaurant's primary branch. */
    async vatSettings(restaurantId: string, branchId?: string | null) {
      const rows = await db
        .select({ id: branches.id, vatRate: branches.vatRate, inclusive: branches.pricesVatInclusive, isPrimary: branches.isPrimary })
        .from(branches)
        .where(and(eq(branches.restaurantId, restaurantId), isNull(branches.deletedAt)));
      const b = (branchId && rows.find((r) => r.id === branchId)) || rows.find((r) => r.isPrimary) || null;
      return { branchFound: branchId ? rows.some((r) => r.id === branchId) : true, branch: b };
    },

    async activeMenuItems(restaurantId: string, ids: string[]) {
      return db
        .select({ id: menuItems.id, name: menuItems.name, isActive: menuItems.isActive })
        .from(menuItems)
        .where(and(eq(menuItems.restaurantId, restaurantId), inArray(menuItems.id, ids)));
    },

    async openShift(restaurantId: string, shiftId: string) {
      const [s] = await db
        .select({ id: shifts.id, status: shifts.status })
        .from(shifts)
        .where(and(eq(shifts.id, shiftId), eq(shifts.restaurantId, restaurantId)));
      return s ?? null;
    },

    async customer(restaurantId: string, customerId: string) {
      const [c] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.restaurantId, restaurantId)));
      return c ?? null;
    },

    async tableBelongs(restaurantId: string, tableId: string) {
      const [r] = await tx<{ ok: boolean }[]>`select exists(select 1 from public.pos_tables where id = ${tableId} and restaurant_id = ${restaurantId}) as ok`;
      return !!r?.ok;
    },

    /** Next RCP-YYYYMMDD-NNNN for this restaurant and day (row-locked inside the transaction). */
    async nextReceiptNumber(restaurantId: string, day: string) {
      const [r] = await tx<{ n: number }[]>`
        insert into platform.pos_receipt_counters (restaurant_id, day, last_value)
        values (${restaurantId}, ${day}::date, 1)
        on conflict (restaurant_id, day) do update set last_value = platform.pos_receipt_counters.last_value + 1
        returning last_value as n`;
      return `RCP-${day.replaceAll("-", "")}-${String(r.n).padStart(4, "0")}`;
    },

    /**
     * Claims an idempotency key. Returns the stored response when the key was already used;
     * a concurrent request with the same key waits on the unique index until the first commits.
     */
    async claimIdempotencyKey(restaurantId: string, key: string, terminal: string) {
      const inserted = await db
        .insert(posIdempotencyKeys)
        .values({ restaurantId, idempotencyKey: key, terminalUid: terminal, entityType: "api.pos.sale", status: "processing" })
        .onConflictDoNothing()
        .returning({ id: posIdempotencyKeys.id });
      if (inserted.length) return { claimed: true as const, id: inserted[0].id };
      const [existing] = await db
        .select({ response: posIdempotencyKeys.response, status: posIdempotencyKeys.status, entityType: posIdempotencyKeys.entityType })
        .from(posIdempotencyKeys)
        .where(and(eq(posIdempotencyKeys.restaurantId, restaurantId), eq(posIdempotencyKeys.idempotencyKey, key)));
      await db
        .update(posIdempotencyKeys)
        .set({ replayCount: dsql`${posIdempotencyKeys.replayCount} + 1`, lastReplayAt: new Date().toISOString() })
        .where(and(eq(posIdempotencyKeys.restaurantId, restaurantId), eq(posIdempotencyKeys.idempotencyKey, key)));
      return { claimed: false as const, existing };
    },

    async completeIdempotencyKey(id: string, response: unknown, shiftId: string | null) {
      await db.update(posIdempotencyKeys).set({ response, status: "completed", shiftId }).where(eq(posIdempotencyKeys.id, id));
    },

    async insertSale(values: typeof salesTransactions.$inferInsert) {
      const [row] = await db.insert(salesTransactions).values(values).returning();
      return row;
    },

    async insertItems(values: (typeof salesItems.$inferInsert)[]) {
      return db.insert(salesItems).values(values).returning();
    },

    async insertCashEvent(values: typeof cashEvents.$inferInsert) {
      await db.insert(cashEvents).values(values);
    },

    /**
     * Stock is deducted by the database, once, for every way a sale is recorded: the trigger
     * on sales_items runs post_provisional_cogs_for_sale_item (atomic since 20261109221347),
     * which writes stock_movements and provisional_cogs_postings. We deliberately do NOT
     * write inventory_usage here: its own trigger (auto_deduct_inventory_stock) would deduct
     * the same ingredients a second time. After the lines are inserted we only create one
     * pending reorder request per ingredient now at or below its reorder level.
     */
    async createReorderRequests(params: { restaurantId: string; sold: { menuItemId: string; quantity: number; name: string }[] }) {
      if (!params.sold.length) return [];
      const sold = JSON.stringify(params.sold);
      return tx<{ inventory_item_id: string; current_stock: number; reorder_level: number | null }[]>`
        with sold as (
          select (s->>'menuItemId')::uuid as menu_item_id, (s->>'quantity')::numeric as qty, s->>'name' as name
          from jsonb_array_elements(${sold}::jsonb) s
        ),
        need as (
          select distinct ri.inventory_item_id
          from public.recipe_ingredients ri
          join sold on sold.menu_item_id = ri.menu_item_id
          where ri.restaurant_id = ${params.restaurantId}
        ),
        items as (
          select i.id, i.current_stock, i.reorder_level
          from public.inventory_items i
          join need on need.inventory_item_id = i.id
          where i.restaurant_id = ${params.restaurantId}
        ),
        reorder as (
          insert into public.reorder_requests (restaurant_id, inventory_item_id, current_stock, reorder_level, requested_quantity)
          select ${params.restaurantId}, it.id, greatest(it.current_stock, 0), it.reorder_level, it.reorder_level * 2
          from items it
          where it.reorder_level is not null and it.current_stock <= it.reorder_level
            and not exists (select 1 from public.reorder_requests rr where rr.inventory_item_id = it.id and rr.status = 'pending')
          returning inventory_item_id
        )
        select it.id as inventory_item_id, it.current_stock::float8 as current_stock, it.reorder_level::float8 as reorder_level
        from items it
        where it.reorder_level is not null and it.current_stock <= it.reorder_level`;
    },

    async emitEvent(restaurantId: string, saleId: string, payload: Record<string, unknown>) {
      await tx`select platform.emit_event('pos', 'pos.sale.created', ${restaurantId}::uuid, ${saleId}::uuid, ${JSON.stringify(payload)}::jsonb)`;
    },
  };
}
