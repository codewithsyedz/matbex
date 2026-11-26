/**
 * Customer credit: /api/v1/credit/* (server/src/modules/credit). The server recomputes the
 * customer's balance after every change and returns it as `balance`.
 */
import { apiRequest } from "./http";

export type CreditPayMethod = "cash" | "card" | "bank_transfer" | "cheque" | "other";

export interface SettlementInvoiceRow {
  id: string;
  invoice_number: string;
  total_amount: number;
  amount_paid?: number;
  status: string;
}

export async function createSettlementInvoice(input: {
  restaurantId: string;
  customerId: string;
  mode: "full" | "period" | "custom";
  periodStart?: string;
  periodEnd?: string;
  amount?: number;
  dueDate?: string;
  notes?: string | null;
}) {
  const { data } = await apiRequest<{ invoice: SettlementInvoiceRow & { transaction_count: number }; balance: number }>(
    "/credit/settlement-invoices",
    { body: input },
  );
  return data;
}

export async function paySettlementInvoice(invoiceId: string, input: { restaurantId: string; amount: number; paymentMethod: CreditPayMethod; notes?: string | null }) {
  const { data } = await apiRequest<{ invoice: SettlementInvoiceRow; fullyPaid: boolean; balance: number }>(
    `/credit/settlement-invoices/${invoiceId}/payments`,
    { body: input },
  );
  return data;
}

/** Dates, notes and the overdue flag; paid/partial/settled follow the payments. */
export async function editSettlementInvoice(
  invoiceId: string,
  input: { restaurantId: string; periodStart?: string; periodEnd?: string; dueDate?: string | null; notes?: string | null; overdue?: boolean },
) {
  const { data } = await apiRequest<{ invoice: SettlementInvoiceRow }>(`/credit/settlement-invoices/${invoiceId}`, { method: "PATCH", body: input });
  return data;
}

/** Only while nothing has been paid on it; its sales go back on the customer's tab. */
export async function deleteSettlementInvoice(invoiceId: string, restaurantId: string) {
  const { data } = await apiRequest<{ deleted: string; balance: number }>(
    `/credit/settlement-invoices/${invoiceId}?restaurantId=${encodeURIComponent(restaurantId)}`,
    { method: "DELETE" },
  );
  return data;
}

/** Instalment on one credit sale (not one that is on a settlement invoice). */
export async function payCreditSale(saleId: string, input: { restaurantId: string; amount: number; paymentMethod: CreditPayMethod; notes?: string | null }) {
  const { data } = await apiRequest<{ fullyPaid: boolean; paidAmount: number; balance: number }>(`/credit/sales/${saleId}/payments`, { body: input });
  return data;
}

/** Write off what a credit sale still owes. */
export async function writeOffCreditSale(saleId: string, input: { restaurantId: string; notes?: string | null }) {
  const { data } = await apiRequest<{ adjustmentId: string; amount: number; balance: number }>(`/credit/sales/${saleId}/write-off`, { body: input });
  return data;
}

/** Undo a write-off (once); a write-off of a sale puts the sale back on the tab. */
export async function revertWriteOff(adjustmentId: string, restaurantId: string) {
  const { data } = await apiRequest<{ balance: number }>(`/credit/adjustments/${adjustmentId}/revert`, { body: { restaurantId } });
  return data;
}

/** Manual balance adjustment not tied to a sale. */
export async function addBalanceAdjustment(input: {
  restaurantId: string;
  customerId: string;
  type: "credit" | "debit" | "correction" | "write_off";
  amount: number;
  reason: string;
  notes?: string | null;
  createdAt?: string | null;
}) {
  const { data } = await apiRequest<{ adjustment: { id: string }; balance: number }>("/credit/adjustments", { body: input });
  return data;
}
