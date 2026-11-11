/**
 * Customer credit: settlement invoices, payments, instalments, write-offs and manual
 * adjustments, each in one transaction. The customer's balance is not written here: the
 * database recomputes it from sales, adjustments and invoices on every change
 * (recompute_customer_balance, 20261110172707), so the rules below only decide what is
 * recorded.
 *
 * - An invoice bills open credit sales (unpaid, not voided, not on another invoice) for what
 *   they still owe, or a custom amount with no sales linked.
 * - A payment on an invoice is allocated to its sales oldest first; the invoice is settled
 *   when fully paid. Each payment posts DR cash/bank, CR receivables (database trigger).
 * - An instalment pays one credit sale directly (not one that is on an invoice).
 * - A write-off settles what a sale still owes and keeps a write_off adjustment tied to it;
 *   reverting puts the sale back on the customer's tab.
 * - Ledger: tab sales are debited to Customer Accounts receivable (1130) at End of Day.
 *   Instalments, write-offs (on a sale or manual) and write-off reversals credit/debit it in
 *   the same transaction as the adjustment (repo.postToLedger); invoice payments do so by trigger.
 */
import { badRequest, HttpError } from "../../lib/errors.js";
import type { DbClaims } from "../../db.js";
import { inServiceTx } from "../shared/db.js";
import { requireRestaurantRole, type RestaurantRole } from "../shared/access.js";
import { creditRepository } from "./credit.repository.js";
import type { AdjustmentInput, CreateInvoiceInput, EditInvoiceInput, PaymentInput, WriteOffInput } from "./credit.schema.js";
import { roundMoney, sumMoney } from "../../../../src/lib/vatInclusive.ts";

type Claims = DbClaims & { sub: string };
const CREDIT_ROLES: RestaurantRole[] = ["owner", "manager", "accountant"];
const conflict = (msg: string, code: string) => new HttpError(409, msg, code);
const notFound = (what: string) => new HttpError(404, `${what} not found`, `${what.toLowerCase().replace(/ /g, "_")}_not_found`);
const owed = (s: { total: number; paid_amount: number }) => roundMoney(Math.max(0, s.total - s.paid_amount));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000).toISOString().slice(0, 10);

export async function createInvoice(input: CreateInvoiceInput, claims: Claims) {
  if (input.mode === "custom" && !input.amount) throw badRequest("amount is required for a custom invoice", "amount_required");
  if (input.mode !== "custom" && input.amount != null) throw badRequest("amount is only for custom invoices", "amount_not_allowed");
  if (input.mode === "period" && (!input.periodStart || !input.periodEnd)) throw badRequest("periodStart and periodEnd are required", "period_required");
  if (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd) throw badRequest("Period ends before it starts", "period_invalid");

  return inServiceTx(claims, async (t) => {
    const repo = creditRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, CREDIT_ROLES);
    const customer = await repo.customer(input.restaurantId, input.customerId);
    if (!customer) throw notFound("Customer");

    const sales = input.mode === "custom" ? [] : await repo.openSales(input.restaurantId, customer.id,
      input.mode === "period" ? { from: input.periodStart!, to: input.periodEnd! } : undefined);
    if (input.mode !== "custom" && !sales.length) throw conflict("No open credit sales to invoice", "nothing_to_invoice");

    const total = input.mode === "custom" ? roundMoney(input.amount!) : sumMoney(sales.map(owed));
    const today = new Date().toISOString().slice(0, 10);
    const first = sales[0]?.created_at.slice(0, 10) ?? today;
    const invoice = await repo.insertInvoice({
      restaurantId: input.restaurantId,
      customerId: customer.id,
      invoiceNumber: await repo.nextInvoiceNumber(input.restaurantId, customer.name),
      periodStart: input.periodStart ?? first,
      periodEnd: input.periodEnd ?? today,
      // Sales already carry their VAT; the invoice is a statement of what is owed.
      subtotal: total,
      tax: 0,
      total,
      dueDate: input.dueDate ?? addDays(new Date(), 30),
      notes: input.notes ?? null,
    });
    await repo.linkSales(invoice.id, sales.map((s) => s.id));
    await repo.audit({
      restaurantId: input.restaurantId, invoiceId: invoice.id, customerId: customer.id, action: "invoice_created", userId: claims.sub,
      details: { transaction_count: sales.length, total_amount: total, settlement_mode: input.mode },
    });
    return { invoice: { ...invoice, amount_paid: 0, transaction_count: sales.length }, balance: await repo.balance(customer.id) };
  });
}

export async function payInvoice(invoiceId: string, input: PaymentInput, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = creditRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, CREDIT_ROLES);
    const inv = await repo.lockInvoice(input.restaurantId, invoiceId);
    if (!inv) throw notFound("Invoice");
    const remaining = roundMoney(inv.total_amount - inv.amount_paid);
    const amount = roundMoney(input.amount);
    if (remaining <= 0) throw conflict("This invoice is already paid", "invoice_paid");
    if (amount > remaining + 0.004) throw badRequest(`Payment exceeds the remaining ${remaining.toFixed(2)}`, "overpayment");

    const payment = await repo.insertPayment({
      restaurantId: input.restaurantId, invoiceId: inv.id, amount, method: input.paymentMethod, userId: claims.sub, notes: input.notes ?? null,
    });
    const paid = roundMoney(inv.amount_paid + amount);
    const fully = paid + 0.004 >= inv.total_amount;
    const updated = await repo.updateInvoice(inv.id, {
      amount_paid: paid,
      status: fully ? "settled" : "partial",
      ...(fully ? { paid_at: new Date().toISOString(), paid_by: claims.sub, payment_method: input.paymentMethod } : {}),
    });

    // Allocate to the invoice's sales, oldest first.
    let left = amount;
    for (const s of await repo.invoiceSales(inv.id)) {
      if (s.settlement_status !== "unpaid") continue;
      const apply = fully ? owed(s) : Math.min(left, owed(s));
      if (apply <= 0) continue;
      const newPaid = roundMoney(s.paid_amount + apply);
      await repo.setSalePaid(s.id, newPaid, newPaid + 0.004 >= s.total ? "settled" : "unpaid");
      left = roundMoney(left - apply);
      if (!fully && left <= 0) break;
    }

    const customer = await repo.customer(input.restaurantId, inv.customer_id);
    if (fully && customer) {
      // History row for the customer's timeline. It does not change the balance (the payments
      // do) and is marked posted: the payments already posted the receipt.
      await repo.insertAdjustment({
        restaurantId: input.restaurantId, tenantId: customer.tenant_id, customerId: customer.id, type: "settlement",
        amount: inv.total_amount, reason: `Settlement invoice ${inv.invoice_number} paid`,
        notes: inv.linked ? "Settlement payment received for linked invoice transactions" : "Custom amount settlement",
        userId: claims.sub, reference: inv.invoice_number, ledgerPosted: true, ledgerTransactionId: payment.ledger_transaction_id,
      });
    }
    await repo.audit({
      restaurantId: input.restaurantId, invoiceId: inv.id, customerId: inv.customer_id, action: fully ? "invoice_settled" : "payment_recorded",
      userId: claims.sub, details: { amount, payment_method: input.paymentMethod },
    });
    return { invoice: updated, paymentId: payment.id, fullyPaid: fully, balance: await repo.balance(inv.customer_id) };
  });
}

export async function editInvoice(invoiceId: string, input: EditInvoiceInput, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = creditRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, CREDIT_ROLES);
    const inv = await repo.lockInvoice(input.restaurantId, invoiceId);
    if (!inv) throw notFound("Invoice");
    const set: Record<string, unknown> = {};
    if (input.periodStart) set.billing_period_start = input.periodStart;
    if (input.periodEnd) set.billing_period_end = input.periodEnd;
    if (input.dueDate !== undefined) set.due_date = input.dueDate;
    if (input.notes !== undefined) set.notes = input.notes;
    if (input.overdue !== undefined) {
      if (inv.status === "settled") throw conflict("A settled invoice cannot be overdue", "invoice_paid");
      set.status = input.overdue ? "overdue" : inv.amount_paid > 0 ? "partial" : "pending";
    }
    const updated = await repo.updateInvoice(inv.id, set);
    await repo.audit({
      restaurantId: input.restaurantId, invoiceId: inv.id, customerId: inv.customer_id, action: "invoice_updated", userId: claims.sub,
      details: { changes: set },
    });
    return { invoice: updated };
  });
}

/** Only an invoice nothing has been paid on can go (its sales return to the open tab). */
export async function deleteInvoice(invoiceId: string, restaurantId: string, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = creditRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, restaurantId, CREDIT_ROLES);
    const inv = await repo.lockInvoice(restaurantId, invoiceId);
    if (!inv) throw notFound("Invoice");
    if (inv.amount_paid > 0) {
      throw conflict("Payments were received on this invoice (and posted to the ledger); it cannot be deleted", "invoice_has_payments");
    }
    await repo.unlinkSales(inv.id);
    await repo.audit({
      restaurantId, invoiceId: inv.id, customerId: inv.customer_id, action: "invoice_deleted", userId: claims.sub,
      details: { invoice_number: inv.invoice_number, total_amount: inv.total_amount },
    });
    await repo.deleteInvoice(inv.id);
    return { deleted: inv.id, balance: await repo.balance(inv.customer_id) };
  });
}

/** Instalment on one credit sale. */
export async function paySale(saleId: string, input: PaymentInput, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = creditRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, CREDIT_ROLES);
    const sale = await repo.lockSale(input.restaurantId, saleId);
    if (!sale) throw notFound("Sale");
    if (!sale.customer_id || sale.settlement_status !== "unpaid" || sale.voided_at) throw conflict("This sale is not open on a customer's tab", "not_open_credit");
    if (sale.settlement_invoice_id) throw conflict("This sale is on a settlement invoice; record the payment on the invoice", "in_settlement");
    const amount = roundMoney(input.amount);
    const remaining = owed(sale);
    if (amount > remaining + 0.004) throw badRequest(`Amount exceeds the remaining ${remaining.toFixed(2)}`, "overpayment");

    const customer = (await repo.customer(input.restaurantId, sale.customer_id))!;
    const newPaid = roundMoney(sale.paid_amount + amount);
    const fully = newPaid + 0.004 >= sale.total;
    await repo.setSalePaid(sale.id, newPaid, fully ? "paid" : "unpaid");
    // Tied to the sale: a record of the instalment, not a second reduction of the balance.
    const adj = await repo.insertAdjustment({
      restaurantId: input.restaurantId, tenantId: customer.tenant_id, customerId: customer.id, type: "credit", amount,
      reason: `Payment for ${sale.receipt_number ?? sale.id}`,
      notes: `${input.paymentMethod.toUpperCase()} payment${input.notes ? `: ${input.notes}` : ""}`,
      userId: claims.sub, saleId: sale.id, reference: sale.receipt_number,
    });
    await repo.postToLedger(adj.id, "collection", { paymentMethod: input.paymentMethod });
    return { fullyPaid: fully, paidAmount: newPaid, balance: await repo.balance(customer.id) };
  });
}

export async function writeOffSale(saleId: string, input: WriteOffInput, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = creditRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, ["owner", "manager"]);
    const sale = await repo.lockSale(input.restaurantId, saleId);
    if (!sale) throw notFound("Sale");
    if (!sale.customer_id || sale.settlement_status !== "unpaid" || sale.voided_at) throw conflict("This sale is not open on a customer's tab", "not_open_credit");
    if (sale.settlement_invoice_id) throw conflict("This sale is on a settlement invoice; delete or settle the invoice first", "in_settlement");
    const amount = owed(sale);
    const customer = (await repo.customer(input.restaurantId, sale.customer_id))!;
    await repo.setSalePaid(sale.id, sale.paid_amount, "settled");
    const adj = await repo.insertAdjustment({
      restaurantId: input.restaurantId, tenantId: customer.tenant_id, customerId: customer.id, type: "write_off", amount,
      reason: `Write-off for transaction ${sale.receipt_number ?? sale.id}`,
      notes: input.notes ?? `Transaction dated ${sale.created_at.slice(0, 10)} written off`,
      userId: claims.sub, saleId: sale.id,
    });
    await repo.postToLedger(adj.id, "write_off");
    return { adjustmentId: adj.id, amount, balance: await repo.balance(customer.id) };
  });
}

/** Undo a write-off once. A write-off tied to a sale puts that sale back on the tab. */
export async function revertWriteOff(adjustmentId: string, restaurantId: string, claims: Claims) {
  return inServiceTx(claims, async (t) => {
    const repo = creditRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, restaurantId, ["owner", "manager"]);
    const adj = await repo.lockAdjustment(restaurantId, adjustmentId);
    if (!adj) throw notFound("Adjustment");
    if (adj.adjustment_type !== "write_off") throw conflict("Only write-offs can be reverted", "not_write_off");
    if (await repo.reversalExists(adj.id)) throw conflict("This write-off was already reverted", "already_reverted");
    const customer = (await repo.customer(restaurantId, adj.customer_id))!;
    if (adj.transaction_id) {
      const sale = await repo.lockSale(restaurantId, adj.transaction_id);
      if (!sale || sale.voided_at) throw conflict("The written-off sale was voided", "sale_voided");
      if (sale.settlement_status === "settled") await repo.setSalePaid(sale.id, sale.paid_amount, "unpaid");
    }
    const reversal = await repo.insertAdjustment({
      restaurantId, tenantId: customer.tenant_id, customerId: customer.id, type: "debit", amount: adj.amount,
      reason: `Reversal of write-off: ${adj.reason}`,
      notes: `Reverted write-off from ${adj.created_at.slice(0, 10)}. Original reference: ${adj.reference_number ?? "N/A"}`,
      userId: claims.sub, saleId: adj.transaction_id, reference: `REV-${adj.id}`,
    });
    // Only undo in the ledger what reached it (write-offs from before posting began did not).
    if (adj.ledger_posted) await repo.postToLedger(reversal.id, "write_off_reversal", { reverses: adj.id });
    return { balance: await repo.balance(customer.id) };
  });
}

/** Manual adjustment not tied to a sale (opening balances, goodwill credits, corrections). */
export async function addAdjustment(input: AdjustmentInput, claims: Claims) {
  if (input.createdAt && new Date(input.createdAt).getTime() > Date.now() + 5 * 60_000) throw badRequest("Date is in the future", "future_date");
  return inServiceTx(claims, async (t) => {
    const repo = creditRepository(t);
    await requireRestaurantRole(t.tx, claims.sub, input.restaurantId, CREDIT_ROLES);
    const customer = await repo.customer(input.restaurantId, input.customerId);
    if (!customer) throw notFound("Customer");
    const adj = await repo.insertAdjustment({
      restaurantId: input.restaurantId, tenantId: customer.tenant_id, customerId: customer.id, type: input.type,
      amount: roundMoney(input.amount), reason: input.reason.trim(), notes: input.notes?.trim() || null,
      userId: claims.sub, createdAt: input.createdAt ?? null,
    });
    // A manual write-off reduces what the customer owes like one on a sale. Other manual
    // adjustments (opening balances, goodwill, corrections) stay off the ledger.
    if (input.type === "write_off") await repo.postToLedger(adj.id, "write_off");
    return { adjustment: adj, balance: await repo.balance(customer.id) };
  });
}
