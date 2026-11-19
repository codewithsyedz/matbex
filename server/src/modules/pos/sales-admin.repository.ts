/**
 * Data access for back-office sales. Modules run as the table owner, so every query is scoped
 * by restaurant_id here (RLS is not the safety net).
 */
import type { ServiceTx } from "../shared/db.js";
import type { SaleRow } from "./sales-admin.schema.js";

const SALE_COLS = `id, receipt_number, payment_method::text as payment_method, subtotal::float8 as subtotal,
  tax::float8 as tax, total::float8 as total, settlement_status::text as settlement_status, shift_id,
  branch_id, created_at::text as created_at`;

export interface LockedSale extends SaleRow {
  customer_id: string | null;
  voided_at: string | null;
  voids_transaction_id: string | null;
  settlement_invoice_id: string | null;
  zatca_clearance_status: string | null;
  line_count: number;
}

export function salesAdminRepository({ tx }: ServiceTx) {
  return {
    /** The sale, row-locked for the rest of the transaction, or null when not in this restaurant. */
    async lockSale(restaurantId: string, saleId: string): Promise<LockedSale | null> {
      const [row] = await tx.unsafe<LockedSale[]>(
        `select ${SALE_COLS}, customer_id, voided_at::text as voided_at, voids_transaction_id,
                settlement_invoice_id, zatca_clearance_status,
                (select count(*)::int from public.sales_items si where si.transaction_id = st.id) as line_count
         from public.sales_transactions st
         where st.id = $1 and st.restaurant_id = $2
         for update`,
        [saleId, restaurantId],
      );
      return row ?? null;
    },

    async shift(restaurantId: string, shiftId: string) {
      const [s] = await tx<{ id: string; status: string }[]>`
        select id, status::text as status from public.shifts where id = ${shiftId} and restaurant_id = ${restaurantId}`;
      return s ?? null;
    },

    /** Noon of a business day in the restaurant's time zone, as a timestamptz string. */
    async noonOf(restaurantId: string, businessDate: string) {
      const [r] = await tx<{ at: string; today: string }[]>`
        select ((${businessDate}::date + time '12:00') at time zone coalesce(r.timezone, 'Asia/Riyadh'))::text as at,
               to_char((now() at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date, 'YYYY-MM-DD') as today
        from public.restaurants r where r.id = ${restaurantId}`;
      return r;
    },

    async businessDay(restaurantId: string, at: string | null) {
      const [r] = await tx<{ day: string; at: string }[]>`
        select to_char((coalesce(${at}::timestamptz, now()) at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date, 'YYYY-MM-DD') as day,
               coalesce(${at}::timestamptz, now())::text as at
        from public.restaurants r where r.id = ${restaurantId}`;
      return r;
    },

    async insertSale(v: {
      restaurantId: string; branchId: string | null; shiftId: string | null; paymentMethod: string;
      subtotal: number; tax: number; total: number; receiptNumber: string; settlement: string;
      customerId?: string | null; createdAt: string; voidsTransactionId?: string | null;
    }): Promise<SaleRow> {
      const [row] = await tx.unsafe<SaleRow[]>(
        `insert into public.sales_transactions
           (restaurant_id, branch_id, shift_id, payment_method, subtotal, tax, total, receipt_number,
            settlement_status, customer_id, created_at, voids_transaction_id, settled_at)
         values ($1, $2, $3, $4::payment_method, $5, $6, $7, $8, $9::transaction_settlement_status, $10, $11::timestamptz, $12,
                 case when $9 = 'settled' then now() end)
         returning ${SALE_COLS}`,
        [v.restaurantId, v.branchId, v.shiftId, v.paymentMethod, v.subtotal, v.tax, v.total, v.receiptNumber,
          v.settlement, v.customerId ?? null, v.createdAt, v.voidsTransactionId ?? null],
      );
      return row;
    },

    async insertCashEvent(v: { restaurantId: string; shiftId: string; type: "sale" | "refund"; amount: number; paymentMethod: string; userId: string; description: string; saleId: string }) {
      await tx`
        insert into public.cash_events (shift_id, restaurant_id, event_type, amount, payment_method, created_by, description, reference_type, reference_id)
        values (${v.shiftId}, ${v.restaurantId}, ${v.type}, ${v.amount}, ${v.paymentMethod}, ${v.userId}, ${v.description}, 'sales_transaction', ${v.saleId})`;
    },

    /** The drawer entry for a sale (API sales and summaries reference it). */
    async saleCashEvents(restaurantId: string, saleId: string) {
      return tx<{ id: string; shift_id: string; event_type: string }[]>`
        select id, shift_id, event_type from public.cash_events
        where restaurant_id = ${restaurantId} and reference_type = 'sales_transaction' and reference_id = ${saleId}`;
    },

    async updateSaleCashEvents(restaurantId: string, saleId: string, set: { amount?: number; paymentMethod?: string; shiftId?: string }) {
      await tx`
        update public.cash_events
           set amount = coalesce(${set.amount ?? null}::numeric, amount),
               payment_method = coalesce(${set.paymentMethod ?? null}, payment_method),
               shift_id = coalesce(${set.shiftId ?? null}::uuid, shift_id)
         where restaurant_id = ${restaurantId} and reference_type = 'sales_transaction'
           and reference_id = ${saleId} and event_type = 'sale'`;
    },

    async deleteSaleCashEvents(restaurantId: string, saleId: string) {
      await tx`
        delete from public.cash_events
         where restaurant_id = ${restaurantId} and reference_type = 'sales_transaction'
           and reference_id = ${saleId} and event_type = 'sale'`;
    },

    /** Puts recipe stock back and voids the provisional COGS journal of every line. */
    async reverseStock(saleId: string, reason: string) {
      await tx`select public.reverse_provisional_cogs_for_sale(${saleId}::uuid, ${reason})`;
      // Food-cost rows mirror the postings just reversed.
      await tx`
        delete from public.inventory_usage
         where sale_item_id in (select id from public.sales_items where transaction_id = ${saleId})`;
    },

    async markVoided(saleId: string, userId: string, reason: string, settleCredit: boolean) {
      await tx`
        update public.sales_transactions
           set voided_at = now(), voided_by = ${userId}, void_reason = ${reason},
               settlement_status = case when ${settleCredit} then 'settled'::transaction_settlement_status else settlement_status end,
               settled_at = case when ${settleCredit} then now() else settled_at end
         where id = ${saleId}`;
    },

    async cancelKitchenTickets(restaurantId: string, saleId: string) {
      await tx`
        update public.pos_kds_tickets set status = 'cancelled', cancelled_at = now()
         where restaurant_id = ${restaurantId} and source_order_id = ${saleId}
           and status not in ('served', 'cancelled')`;
    },

    async updateSaleAmounts(saleId: string, v: { subtotal: number; tax: number; total: number; paymentMethod?: string }) {
      const [row] = await tx.unsafe<SaleRow[]>(
        `update public.sales_transactions
            set subtotal = $2, tax = $3, total = $4,
                payment_method = coalesce($5::payment_method, payment_method)
          where id = $1
          returning ${SALE_COLS}`,
        [saleId, v.subtotal, v.tax, v.total, v.paymentMethod ?? null],
      );
      return row;
    },

    async setSaleShift(saleId: string, shiftId: string | null) {
      const [row] = await tx.unsafe<SaleRow[]>(
        `update public.sales_transactions set shift_id = $2 where id = $1 returning ${SALE_COLS}`,
        [saleId, shiftId],
      );
      return row;
    },

    async setPaymentMethod(saleId: string, paymentMethod: string) {
      const [row] = await tx.unsafe<SaleRow[]>(
        `update public.sales_transactions set payment_method = $2::payment_method where id = $1 returning ${SALE_COLS}`,
        [saleId, paymentMethod],
      );
      return row;
    },

    async line(saleId: string, lineId: string) {
      const [l] = await tx<{ id: string; menu_item_id: string; quantity: number; unit_price: number; branch_id: string | null; restaurant_id: string }[]>`
        select id, menu_item_id, quantity, unit_price::float8 as unit_price, branch_id, restaurant_id
        from public.sales_items where id = ${lineId} and transaction_id = ${saleId}`;
      return l ?? null;
    },

    /** Deleting a line reverses its stock and COGS (trg_sales_items_before_delete_cogs). */
    async deleteLine(lineId: string) {
      await tx`delete from public.sales_items where id = ${lineId}`;
    },

    /** Inserting a line deducts its stock and posts provisional COGS (trg_sales_items_after_insert_cogs). */
    async insertLine(v: { restaurantId: string; saleId: string; menuItemId: string; quantity: number; unitPrice: number; totalPrice: number; branchId: string | null }) {
      const [l] = await tx<{ id: string }[]>`
        insert into public.sales_items (restaurant_id, transaction_id, menu_item_id, quantity, unit_price, total_price, branch_id)
        values (${v.restaurantId}, ${v.saleId}, ${v.menuItemId}, ${v.quantity}, ${v.unitPrice}, ${v.totalPrice}, ${v.branchId})
        returning id`;
      return l.id;
    },

    async lineTotals(saleId: string) {
      return tx<{ total_price: number }[]>`
        select total_price::float8 as total_price from public.sales_items where transaction_id = ${saleId}`;
    },

    async setBranch(saleId: string, branchId: string | null) {
      const [row] = await tx.unsafe<SaleRow[]>(
        `update public.sales_transactions set branch_id = $2 where id = $1 returning ${SALE_COLS}`,
        [saleId, branchId],
      );
      return row;
    },

    async branchBelongs(restaurantId: string, branchId: string) {
      const [r] = await tx<{ ok: boolean }[]>`
        select exists(select 1 from public.branches where id = ${branchId} and restaurant_id = ${restaurantId} and deleted_at is null) as ok`;
      return !!r?.ok;
    },

    async documentAdjustments(saleId: string) {
      const [r] = await tx<{ discount: number; surcharge: number }[]>`
        select document_discount::float8 as discount, document_surcharge::float8 as surcharge
        from public.sales_transactions where id = ${saleId}`;
      return r ?? { discount: 0, surcharge: 0 };
    },

    async auditLog(v: { userId: string; tenantId: string; action: string; saleId: string; before: unknown; after: unknown }) {
      await tx`
        insert into public.audit_logs (user_id, tenant_id, action, entity_type, entity_id, old_data, new_data)
        values (${v.userId}, ${v.tenantId}, ${v.action}, 'sales_transaction', ${v.saleId},
                ${JSON.stringify(v.before)}::jsonb, ${JSON.stringify(v.after)}::jsonb)`;
    },

    async emitEvent(restaurantId: string, saleId: string, type: string, payload: Record<string, unknown>) {
      await tx`select platform.emit_event('pos', ${type}, ${restaurantId}::uuid, ${saleId}::uuid, ${JSON.stringify(payload)}::jsonb)`;
    },
  };
}
