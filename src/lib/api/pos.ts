/** POS sales: POST /api/v1/pos/sales (server/src/modules/pos). */
import { apiRequest } from "./http";

export type SaleLineSize = "regular" | "quarter" | "half" | "full";

/** Body of a 409 price_changed error (ApiError.details). */
export interface PriceChangedDetails {
  lines: { menuItemId: string; size: SaleLineSize; shown: number; current: number }[];
}

export interface RecordSaleInput {
  restaurantId: string;
  branchId?: string | null;
  shiftId?: string | null;
  customerId?: string | null;
  tableId?: string | null;
  paymentMethod: "cash" | "card" | "other";
  settlement?: "paid" | "unpaid";
  createdAt?: string | null;
  /**
   * `size` picks the price tier; the server prices every line. Send `unitPrice` (what the
   * screen showed) to be told about stale prices (409 price_changed) instead of the server
   * silently charging a different amount. Offline replays must send it.
   */
  lines: { menuItemId: string; size?: SaleLineSize; quantity: number; unitPrice?: number }[];
  /** Only for replaying a sale rung up offline: the printed receipt number and time of sale. */
  offline?: { receiptNumber: string; createdAt: string } | null;
  /** Approval from the integrated card terminal (Hala) for a card sale. */
  cardTerminal?: { provider: "hala"; status: string; reference?: string | null; response?: Record<string, unknown> | null } | null;
  invoice?: {
    subtype?: "SIMPLIFIED" | "STANDARD";
    buyerName?: string | null;
    buyerVat?: string | null;
    buyerOtherId?: string | null;
    buyerAddress?: string | null;
  };
}

export interface RecordSaleResult {
  transaction: {
    id: string;
    receipt_number: string;
    subtotal: number;
    tax: number;
    total: number;
    settlement_status: string;
    payment_method: string;
    created_at: string;
    branch_id: string | null;
  };
  receiptNumber: string;
  salesItems: { menu_item_id: string; quantity: number; unit_price: number; total_price: number }[];
  lowStock: { inventoryItemId: string; name: string; currentStock: number; reorderLevel: number }[];
}

/**
 * Records a sale in one server transaction (sale, lines, cash event, stock via database
 * triggers, reorder requests, kitchen ticket, live event). `idempotencyKey`: generate once per
 * checkout and reuse it if you retry, so a retry never creates a second sale.
 */
export async function recordSale(input: RecordSaleInput, opts: { idempotencyKey: string; terminalId?: string; signal?: AbortSignal }) {
  const { data } = await apiRequest<RecordSaleResult>("/pos/sales", {
    body: input,
    headers: {
      "idempotency-key": opts.idempotencyKey,
      ...(opts.terminalId ? { "x-terminal-id": opts.terminalId } : {}),
    },
    signal: opts.signal,
  });
  return data;
}

export interface SaleQuote {
  lines: { menuItemId: string; size: SaleLineSize; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  tax: number;
  total: number;
  vatRate: number;
  pricesVatInclusive: boolean;
  branchId: string | null;
}

/** What the server would charge for this order now (records nothing). */
export async function quoteSale(input: RecordSaleInput, opts: { signal?: AbortSignal } = {}) {
  const { data } = await apiRequest<SaleQuote>("/pos/sales/quote", { body: input, signal: opts.signal });
  return data;
}

// ---- Back office (server/src/modules/pos/sales-admin.*) -------------------------------------

export interface SaleRow {
  id: string;
  receipt_number: string | null;
  payment_method: string;
  subtotal: number;
  tax: number;
  total: number;
  settlement_status: string;
  shift_id: string | null;
  branch_id: string | null;
  created_at: string;
}

export type SummaryKind = "manual" | "end_of_day" | "end_of_day_no_pos" | "backfill_adjustment";

/**
 * Sales entered as amounts without lines. Amounts include VAT (split with the branch rate unless
 * vatPercent is given). manual: one entry, optional createdAt/shiftId; the others: businessDate,
 * one entry per payment method (negative only for backfill adjustments).
 */
export async function recordSummarySales(input: {
  restaurantId: string;
  branchId?: string | null;
  shiftId?: string | null;
  kind: SummaryKind;
  createdAt?: string | null;
  businessDate?: string | null;
  vatPercent?: number | null;
  entries: { paymentMethod: "cash" | "card" | "other"; total: number }[];
}) {
  const { data } = await apiRequest<{ transactions: SaleRow[]; receiptPrefix: string | null }>("/pos/sales/summary", { body: input });
  return data;
}

/** Void a sale: negative mirror sale, stock back, refund from an open shift's drawer. */
export async function voidSale(saleId: string, input: { restaurantId: string; reason: string; shiftId?: string | null }) {
  const { data } = await apiRequest<{ void: SaleRow; cashRefunded: boolean; refundShiftId: string | null }>(
    `/pos/sales/${saleId}/void`,
    { body: input },
  );
  return data;
}

/** Edit an amount-only sale's total/VAT/payment method, or move a sale to another shift (null: none). */
export async function editSale(
  saleId: string,
  input: { restaurantId: string; total?: number; vatPercent?: number; paymentMethod?: "cash" | "card" | "other"; shiftId?: string | null },
) {
  const { data } = await apiRequest<{ transaction: SaleRow }>(`/pos/sales/${saleId}`, { method: "PATCH", body: input });
  return data;
}

/** Change one line's quantity/price; stock, food cost, totals and the drawer follow. */
export async function editSaleLine(saleId: string, lineId: string, input: { restaurantId: string; quantity: number; unitPrice: number }) {
  const { data } = await apiRequest<{ transaction: SaleRow; lineId: string }>(`/pos/sales/${saleId}/lines/${lineId}`, { method: "PATCH", body: input });
  return data;
}

/** Remove one line (not the last one: void the sale instead). */
export async function deleteSaleLine(saleId: string, lineId: string, restaurantId: string) {
  const { data } = await apiRequest<{ transaction: SaleRow }>(
    `/pos/sales/${saleId}/lines/${lineId}?restaurantId=${encodeURIComponent(restaurantId)}`,
    { method: "DELETE" },
  );
  return data;
}
