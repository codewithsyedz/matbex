/**
 * Request/response contract for POST /api/v1/pos/sales (validated by Fastify's AJV).
 */
const uuid = { type: "string", format: "uuid" } as const;

export const createSaleBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "paymentMethod", "lines"],
  properties: {
    restaurantId: uuid,
    branchId: { ...uuid, nullable: true },
    shiftId: { ...uuid, nullable: true },
    customerId: { ...uuid, nullable: true },
    tableId: { ...uuid, nullable: true },
    paymentMethod: { type: "string", enum: ["cash", "card", "other"] },
    settlement: { type: "string", enum: ["paid", "unpaid"], default: "paid" },
    /** Backdating is allowed for unpaid (credit) sales only. ISO 8601. */
    createdAt: { type: "string", format: "date-time", nullable: true },
    lines: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["menuItemId", "quantity"],
        properties: {
          menuItemId: uuid,
          /** Price tier; the server looks the price up (menu item + branch price list). */
          size: { type: "string", enum: ["regular", "quarter", "half", "full"], default: "regular" },
          quantity: { type: "integer", minimum: 1, maximum: 10000 },
          /**
           * The price the terminal showed. Online sales are rejected with 409 price_changed
           * when it differs from the server price; offline replays are charged at this price
           * (the customer already paid it), so it is required for them.
           */
          unitPrice: { type: "number", minimum: 0, maximum: 1000000 },
        },
      },
    },
    /**
     * Set only when replaying a sale that was rung up offline: keeps the receipt number that
     * was printed and the time of sale, charges the terminal's prices and accepts a shift
     * that has closed since.
     */
    offline: {
      type: "object",
      additionalProperties: false,
      required: ["receiptNumber", "createdAt"],
      properties: {
        receiptNumber: { type: "string", minLength: 1, maxLength: 80 },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    /** Approval from an integrated card terminal (Hala), stored on the sale for audit. */
    cardTerminal: {
      type: "object",
      additionalProperties: false,
      required: ["provider", "status"],
      properties: {
        provider: { type: "string", enum: ["hala"] },
        status: { type: "string", maxLength: 40 },
        reference: { type: "string", maxLength: 200, nullable: true },
        response: { type: "object", nullable: true },
      },
    },
    invoice: {
      type: "object",
      additionalProperties: false,
      properties: {
        subtype: { type: "string", enum: ["SIMPLIFIED", "STANDARD"], default: "SIMPLIFIED" },
        buyerName: { type: "string", maxLength: 300, nullable: true },
        buyerVat: { type: "string", maxLength: 30, nullable: true },
        buyerOtherId: { type: "string", maxLength: 60, nullable: true },
        buyerAddress: { type: "string", maxLength: 500, nullable: true },
      },
    },
  },
} as const;

export type SaleLineSize = "regular" | "quarter" | "half" | "full";

/** POST /api/v1/pos/sales/quote takes the same order; prices sent are ignored. */
export const quoteSaleBody = createSaleBody;

export interface CreateSaleInput {
  restaurantId: string;
  branchId?: string | null;
  shiftId?: string | null;
  customerId?: string | null;
  tableId?: string | null;
  paymentMethod: "cash" | "card" | "other";
  settlement?: "paid" | "unpaid";
  createdAt?: string | null;
  lines: { menuItemId: string; size?: SaleLineSize; quantity: number; unitPrice?: number }[];
  offline?: { receiptNumber: string; createdAt: string } | null;
  cardTerminal?: { provider: "hala"; status: string; reference?: string | null; response?: Record<string, unknown> | null } | null;
  invoice?: {
    subtype?: "SIMPLIFIED" | "STANDARD";
    buyerName?: string | null;
    buyerVat?: string | null;
    buyerOtherId?: string | null;
    buyerAddress?: string | null;
  };
}

export interface CreateSaleResult {
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
  /** Inventory items that reached their reorder level with this sale. */
  lowStock: { inventoryItemId: string; name: string; currentStock: number; reorderLevel: number }[];
}

/** Response of POST /api/v1/pos/sales/quote. */
export interface SaleQuote {
  lines: { menuItemId: string; size: SaleLineSize; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  tax: number;
  total: number;
  vatRate: number;
  pricesVatInclusive: boolean;
  branchId: string | null;
}
