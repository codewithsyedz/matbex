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
        required: ["menuItemId", "quantity", "unitPrice"],
        properties: {
          menuItemId: uuid,
          quantity: { type: "integer", minimum: 1, maximum: 10000 },
          unitPrice: { type: "number", minimum: 0, maximum: 1000000 },
        },
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

export interface CreateSaleInput {
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
  lowStock: { inventoryItemId: string; currentStock: number; reorderLevel: number }[];
}
