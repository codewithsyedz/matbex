/**
 * Data access for customer credit. Modules run as the table owner: every query is scoped by
 * restaurant_id here. customers.current_balance is maintained by the database
 * (recompute_customer_balance, migration 20261110172707); nothing here writes it.
 */
import type { ServiceTx } from "../shared/db.js";

export interface CreditSale {
  id: string;
  receipt_number: string | null;
  total: number;
  paid_amount: number;
  settlement_status: string;
  settlement_invoice_id: string | null;
  voided_at: string | null;
  customer_id: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  customer_id: string;
  invoice_number: string;
  total_amount: number;
  amount_paid: number;
  status: string;
  linked: number;
}

const SALE = `id, receipt_number, total::float8 as total, coalesce(paid_amount, 0)::float8 as paid_amount,
  settlement_status::text as settlement_status, settlement_invoice_id, voided_at::text as voided_at, customer_id,
  created_at::text as created_at`;

export function creditRepository({ tx }: ServiceTx) {
  return {
    async customer(restaurantId: string, customerId: string) {
      const [c] = await tx<{ id: string; name: string; tenant_id: string; current_balance: number }[]>`
        select c.id, c.name, r.tenant_id, c.current_balance::float8 as current_balance
        from public.customers c join public.restaurants r on r.id = c.restaurant_id
        where c.id = ${customerId} and c.restaurant_id = ${restaurantId}`;
      return c ?? null;
    },

    async balance(customerId: string) {
      const [c] = await tx<{ b: number }[]>`select current_balance::float8 as b from public.customers where id = ${customerId}`;
      return c?.b ?? 0;
    },

    /** Open credit sales of a customer (oldest first), optionally within business days [from, to]. */
    async openSales(restaurantId: string, customerId: string, period?: { from: string; to: string }) {
      return tx.unsafe<CreditSale[]>(
        `select ${SALE} from public.sales_transactions st
          where st.restaurant_id = $1 and st.customer_id = $2
            and st.settlement_status = 'unpaid' and st.voided_at is null
            and st.settlement_invoice_id is null
            and st.total - coalesce(st.paid_amount, 0) > 0.004
            and ($3::date is null or (st.created_at at time zone coalesce((select timezone from public.restaurants where id = $1), 'Asia/Riyadh'))::date between $3::date and $4::date)
          order by st.created_at
          for update`,
        [restaurantId, customerId, period?.from ?? null, period?.to ?? null],
      );
    },

    async lockSale(restaurantId: string, saleId: string) {
      const [s] = await tx.unsafe<CreditSale[]>(
        `select ${SALE} from public.sales_transactions where id = $1 and restaurant_id = $2 for update`,
        [saleId, restaurantId],
      );
      return s ?? null;
    },

    async lockInvoice(restaurantId: string, invoiceId: string) {
      const [i] = await tx<Invoice[]>`
        select si.id, si.customer_id, si.invoice_number, si.total_amount::float8 as total_amount,
               si.amount_paid::float8 as amount_paid, si.status::text as status,
               (select count(*)::int from public.sales_transactions l where l.settlement_invoice_id = si.id) as linked
        from public.settlement_invoices si
        where si.id = ${invoiceId} and si.restaurant_id = ${restaurantId}
        for update of si`;
      return i ?? null;
    },

    /** INV-<first 3 letters>-YYYYMMDD-NNN, counting this restaurant's invoices of the day. */
    async nextInvoiceNumber(restaurantId: string, customerName: string) {
      const [r] = await tx<{ day: string; n: number }[]>`
        select to_char((now() at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date, 'YYYYMMDD') as day,
               (select count(*)::int + 1 from public.settlement_invoices si
                 where si.restaurant_id = r.id and si.created_at >= date_trunc('day', now())) as n
        from public.restaurants r where r.id = ${restaurantId}`;
      const prefix = (customerName.replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "CUS").toUpperCase();
      return `INV-${prefix}-${r.day}-${String(r.n).padStart(3, "0")}`;
    },

    async insertInvoice(v: {
      restaurantId: string; customerId: string; invoiceNumber: string; periodStart: string; periodEnd: string;
      subtotal: number; tax: number; total: number; dueDate: string; notes: string | null;
    }) {
      const [i] = await tx<{ id: string; invoice_number: string; total_amount: number; status: string }[]>`
        insert into public.settlement_invoices
          (restaurant_id, customer_id, invoice_number, billing_period_start, billing_period_end,
           subtotal, tax_amount, total_amount, due_date, notes)
        values (${v.restaurantId}, ${v.customerId}, ${v.invoiceNumber}, ${v.periodStart}, ${v.periodEnd},
                ${v.subtotal}, ${v.tax}, ${v.total}, ${v.dueDate}, ${v.notes})
        returning id, invoice_number, total_amount::float8 as total_amount, status::text as status`;
      return i;
    },

    async linkSales(invoiceId: string, saleIds: string[]) {
      if (saleIds.length) await tx`update public.sales_transactions set settlement_invoice_id = ${invoiceId} where id = any(${saleIds}::uuid[])`;
    },

    async unlinkSales(invoiceId: string) {
      await tx`update public.sales_transactions set settlement_invoice_id = null where settlement_invoice_id = ${invoiceId}`;
    },

    async invoiceSales(invoiceId: string) {
      return tx.unsafe<CreditSale[]>(
        `select ${SALE} from public.sales_transactions where settlement_invoice_id = $1 order by created_at for update`,
        [invoiceId],
      );
    },

    async updateInvoice(invoiceId: string, set: Record<string, unknown>) {
      const [i] = await tx`update public.settlement_invoices set ${tx(set)}, updated_at = now() where id = ${invoiceId}
        returning id, invoice_number, total_amount::float8 as total_amount, amount_paid::float8 as amount_paid, status::text as status,
                  billing_period_start::text as billing_period_start, billing_period_end::text as billing_period_end, due_date::text as due_date, notes`;
      return i;
    },

    async deleteInvoice(invoiceId: string) {
      await tx`delete from public.settlement_invoices where id = ${invoiceId}`;
    },

    /** The insert posts DR cash/bank, CR receivables (trg_auto_post_customer_receipt). */
    async insertPayment(v: { restaurantId: string; invoiceId: string; amount: number; method: string; userId: string; notes: string | null }) {
      const [p] = await tx<{ id: string; ledger_transaction_id: string | null }[]>`
        insert into public.settlement_payments (restaurant_id, settlement_invoice_id, amount, payment_method, paid_by, notes)
        values (${v.restaurantId}, ${v.invoiceId}, ${v.amount}, ${v.method}, ${v.userId}, ${v.notes})
        returning id, ledger_transaction_id`;
      return p;
    },

    async setSalePaid(saleId: string, paid: number, status: "unpaid" | "paid" | "settled") {
      await tx`
        update public.sales_transactions
           set paid_amount = ${paid}, settlement_status = ${status}::transaction_settlement_status,
               settled_at = case when ${status} = 'unpaid' then null else coalesce(settled_at, now()) end
         where id = ${saleId}`;
    },

    async insertAdjustment(v: {
      restaurantId: string; tenantId: string; customerId: string; type: string; amount: number; reason: string;
      notes: string | null; userId: string; saleId?: string | null; reference?: string | null; createdAt?: string | null;
      ledgerPosted?: boolean; ledgerTransactionId?: string | null;
    }) {
      const [a] = await tx<{ id: string; reference_number: string | null }[]>`
        insert into public.customer_balance_adjustments
          (restaurant_id, tenant_id, customer_id, adjustment_type, amount, reason, notes, created_by,
           transaction_id, reference_number, created_at, ledger_posted, ledger_transaction_id)
        values (${v.restaurantId}, ${v.tenantId}, ${v.customerId}, ${v.type}, ${v.amount}, ${v.reason}, ${v.notes},
                ${v.userId}, ${v.saleId ?? null}, ${v.reference ?? null}, coalesce(${v.createdAt ?? null}::timestamptz, now()),
                ${v.ledgerPosted ?? false}, ${v.ledgerTransactionId ?? null})
        returning id, reference_number`;
      return a;
    },

    async lockAdjustment(restaurantId: string, adjustmentId: string) {
      const [a] = await tx<{ id: string; customer_id: string; adjustment_type: string; amount: number; reason: string; transaction_id: string | null; reference_number: string | null; created_at: string }[]>`
        select id, customer_id, adjustment_type, amount::float8 as amount, reason, transaction_id, reference_number, created_at::text as created_at
        from public.customer_balance_adjustments where id = ${adjustmentId} and restaurant_id = ${restaurantId} for update`;
      return a ?? null;
    },

    async reversalExists(adjustmentId: string) {
      const [r] = await tx<{ ok: boolean }[]>`
        select exists(select 1 from public.customer_balance_adjustments where reference_number = ${"REV-" + adjustmentId}) as ok`;
      return !!r?.ok;
    },

    async audit(v: { restaurantId: string; invoiceId: string | null; customerId: string; action: string; userId: string; details: Record<string, unknown> }) {
      await tx`
        insert into public.settlement_audit_logs (restaurant_id, settlement_invoice_id, customer_id, action, actor_id, details)
        values (${v.restaurantId}, ${v.invoiceId}, ${v.customerId}, ${v.action}, ${v.userId}, ${JSON.stringify(v.details)}::jsonb)`;
    },
  };
}
