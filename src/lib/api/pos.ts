/** POS sales: POST /api/v1/pos/sales (server/src/modules/pos). */
import { apiRequest } from "./http";

export interface RecordSaleInput {
  restaurantId: string;
  branchId?: string | null;
  shiftId?: string | null;
  customerId?: string | null;
  tableId?: string | null;
  paymentMethod: "cash" | "card" | "other";
  settlement?: "paid" | "unpaid";
  createdAt?: string | null;
  lines: { menuItemId: string; quantity: number; unitPrice: number }[];
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
  lowStock: { inventoryItemId: string; currentStock: number; reorderLevel: number }[];
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
