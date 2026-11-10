/**
 * Back-office sales contracts (validated by Fastify's AJV):
 *   POST   /api/v1/pos/sales/summary                 amount-only sales (manual, end of day, backfill)
 *   POST   /api/v1/pos/sales/:id/void                void a sale (negative mirror sale)
 *   PATCH  /api/v1/pos/sales/:id                     edit amount / payment method / shift
 *   PATCH  /api/v1/pos/sales/:id/lines/:lineId       change a line's quantity or price
 *   DELETE /api/v1/pos/sales/:id/lines/:lineId       remove a line
 */
const uuid = { type: "string", format: "uuid" } as const;
const method = { type: "string", enum: ["cash", "card", "other"] } as const;

export const SUMMARY_KINDS = ["manual", "end_of_day", "end_of_day_no_pos", "backfill_adjustment"] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];

export const summaryBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "kind", "entries"],
  properties: {
    restaurantId: uuid,
    branchId: { ...uuid, nullable: true },
    /** Manual sales only: put the amount in this open shift's drawer. */
    shiftId: { ...uuid, nullable: true },
    kind: { type: "string", enum: [...SUMMARY_KINDS] },
    /** Manual sales: time of sale (backdating allowed, never the future). */
    createdAt: { type: "string", format: "date-time", nullable: true },
    /** End of day / backfill: the business day the totals belong to (YYYY-MM-DD). */
    businessDate: { type: "string", format: "date", nullable: true },
    /** VAT % the amounts include; defaults to the branch rate. */
    vatPercent: { type: "number", minimum: 0, maximum: 100, nullable: true },
    entries: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["paymentMethod", "total"],
        properties: {
          paymentMethod: method,
          /** VAT-inclusive amount; negative only for backfill adjustments. */
          total: { type: "number", minimum: -10000000, maximum: 10000000 },
        },
      },
    },
  },
} as const;

export interface SummaryInput {
  restaurantId: string;
  branchId?: string | null;
  shiftId?: string | null;
  kind: SummaryKind;
  createdAt?: string | null;
  businessDate?: string | null;
  vatPercent?: number | null;
  entries: { paymentMethod: "cash" | "card" | "other"; total: number }[];
}

export const saleParams = {
  type: "object",
  required: ["id"],
  properties: { id: uuid },
} as const;

export const lineParams = {
  type: "object",
  required: ["id", "lineId"],
  properties: { id: uuid, lineId: uuid },
} as const;

export const restaurantQuery = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: uuid },
} as const;

export const voidBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "reason"],
  properties: {
    restaurantId: uuid,
    reason: { type: "string", minLength: 1, maxLength: 500 },
    /** Open shift whose drawer pays the refund; defaults to the sale's shift while it is open. */
    shiftId: { ...uuid, nullable: true },
  },
} as const;

export interface VoidInput {
  restaurantId: string;
  reason: string;
  shiftId?: string | null;
}

export const editBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  minProperties: 2,
  properties: {
    restaurantId: uuid,
    /** New VAT-inclusive total (amount-only sales; sales with lines change through their lines). */
    total: { type: "number", minimum: 0, maximum: 10000000 },
    vatPercent: { type: "number", minimum: 0, maximum: 100 },
    paymentMethod: method,
    /** Move the sale to another shift; null takes it out of any shift. */
    shiftId: { ...uuid, nullable: true },
  },
} as const;

export interface EditInput {
  restaurantId: string;
  total?: number;
  vatPercent?: number;
  paymentMethod?: "cash" | "card" | "other";
  shiftId?: string | null;
}

export const lineBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "quantity", "unitPrice"],
  properties: {
    restaurantId: uuid,
    quantity: { type: "integer", minimum: 1, maximum: 10000 },
    unitPrice: { type: "number", minimum: 0, maximum: 1000000 },
  },
} as const;

export interface LineInput {
  restaurantId: string;
  quantity: number;
  unitPrice: number;
}

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
