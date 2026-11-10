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
