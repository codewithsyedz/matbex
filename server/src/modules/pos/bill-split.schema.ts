/**
 * Request/response contract for POST /api/v1/pos/sales/bill-split and /bill-split/quote
 * (validated by Fastify's AJV). Line and tender shapes are the ones POST /api/v1/pos/sales takes.
 */
import { createSaleBody, type CreateSaleInput, type CreateSaleResult } from "./sales.schema.js";
import { MAX_PARTS, MIN_PARTS } from "./bill-split.js";

const p = createSaleBody.properties;

const partSchema = (withPayments: boolean) => ({
  type: "object",
  additionalProperties: false,
  required: withPayments ? ["lines", "payments"] : ["lines"],
  properties: {
    lines: p.lines,
    ...(withPayments ? { payments: p.payments } : { payments: { ...p.payments, nullable: true } }),
  },
});

const body = (withPayments: boolean) => ({
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "lines", "parts"],
  properties: {
    restaurantId: p.restaurantId,
    branchId: p.branchId,
    shiftId: p.shiftId,
    customerId: p.customerId,
    tableId: p.tableId,
    /** The whole cart as rung up; the parts must add up to exactly these lines. */
    lines: p.lines,
    /** On the whole cart; spread over the parts in proportion to their lines totals. */
    documentDiscount: p.documentDiscount,
    documentSurcharge: p.documentSurcharge,
    /** One sale per part (its own receipt number and simplified invoice), paid by its own tenders. */
    parts: { type: "array", minItems: MIN_PARTS, maxItems: MAX_PARTS, items: partSchema(withPayments) },
    /**
     * Replaying a split bill rung up offline: the time of sale and the receipt number printed
     * for each part, in part order.
     */
    offline: {
      type: "object",
      additionalProperties: false,
      required: ["receiptNumbers", "createdAt"],
      properties: {
        receiptNumbers: { type: "array", minItems: MIN_PARTS, maxItems: MAX_PARTS, items: { type: "string", minLength: 1, maxLength: 80 } },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  },
  definitions: createSaleBody.definitions,
});

export const billSplitBody = body(true);
/** A quote is asked before anyone pays, so parts need no payments. */
export const billSplitQuoteBody = body(false);

type Line = CreateSaleInput["lines"][number];

export interface BillSplitInput {
  restaurantId: string;
  branchId?: string | null;
  shiftId?: string | null;
  customerId?: string | null;
  tableId?: string | null;
  lines: Line[];
  documentDiscount?: number;
  documentSurcharge?: number;
  parts: { lines: Line[]; payments?: CreateSaleInput["payments"] }[];
  offline?: { receiptNumbers: string[]; createdAt: string } | null;
}

export interface BillPart {
  groupId: string;
  /** 1-based position of this part, of `count`. */
  index: number;
  count: number;
}

export interface BillSplitResult {
  billGroupId: string;
  /** One recorded sale per part, in part order. */
  sales: (CreateSaleResult & { billPart: BillPart })[];
}

export interface BillSplitQuote {
  /** What each part will be charged, in part order (its share of the discount/surcharge included). */
  parts: { subtotal: number; tax: number; total: number; documentDiscount: number; documentSurcharge: number }[];
  total: number;
}
