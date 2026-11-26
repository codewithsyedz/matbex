/**
 * Customer credit contracts (validated by Fastify's AJV):
 *   POST   /api/v1/credit/settlement-invoices                     create an invoice
 *   PATCH  /api/v1/credit/settlement-invoices/:id                 dates, notes, overdue flag
 *   DELETE /api/v1/credit/settlement-invoices/:id?restaurantId=   only while nothing is paid
 *   POST   /api/v1/credit/settlement-invoices/:id/payments        receive a payment
 *   POST   /api/v1/credit/sales/:id/payments                      pay one credit sale (instalment)
 *   POST   /api/v1/credit/sales/:id/write-off                     write off what a sale still owes
 *   POST   /api/v1/credit/adjustments                             manual balance adjustment
 *   POST   /api/v1/credit/adjustments/:id/revert                  undo a write-off
 */
const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const method = { type: "string", enum: ["cash", "card", "bank_transfer", "cheque", "other"] } as const;
export type PayMethod = "cash" | "card" | "bank_transfer" | "cheque" | "other";

export const idParams = { type: "object", required: ["id"], properties: { id: uuid } } as const;
export const restaurantQuery = { type: "object", required: ["restaurantId"], properties: { restaurantId: uuid } } as const;

export const createInvoiceBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "customerId", "mode"],
  properties: {
    restaurantId: uuid,
    customerId: uuid,
    /** full: every open credit sale; period: open credit sales in the billing period; custom: an amount, no sales. */
    mode: { type: "string", enum: ["full", "period", "custom"] },
    periodStart: date,
    periodEnd: date,
    amount: { type: "number", exclusiveMinimum: 0, maximum: 100000000 },
    dueDate: date,
    notes: { type: "string", maxLength: 2000, nullable: true },
  },
} as const;
export interface CreateInvoiceInput {
  restaurantId: string;
  customerId: string;
  mode: "full" | "period" | "custom";
  periodStart?: string;
  periodEnd?: string;
  amount?: number;
  dueDate?: string;
  notes?: string | null;
}

export const editInvoiceBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  minProperties: 2,
  properties: {
    restaurantId: uuid,
    periodStart: date,
    periodEnd: date,
    dueDate: { ...date, nullable: true },
    notes: { type: "string", maxLength: 2000, nullable: true },
    /** Only the overdue flag can be set by hand; paid/partial/settled follow the payments. */
    overdue: { type: "boolean" },
  },
} as const;
export interface EditInvoiceInput {
  restaurantId: string;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string | null;
  notes?: string | null;
  overdue?: boolean;
}

export const paymentBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "amount", "paymentMethod"],
  properties: {
    restaurantId: uuid,
    amount: { type: "number", exclusiveMinimum: 0, maximum: 100000000 },
    paymentMethod: method,
    notes: { type: "string", maxLength: 2000, nullable: true },
  },
} as const;
export interface PaymentInput {
  restaurantId: string;
  amount: number;
  paymentMethod: PayMethod;
  notes?: string | null;
}

export const writeOffBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  properties: { restaurantId: uuid, notes: { type: "string", maxLength: 2000, nullable: true } },
} as const;
export interface WriteOffInput {
  restaurantId: string;
  notes?: string | null;
}

export const adjustmentBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "customerId", "type", "amount", "reason"],
  properties: {
    restaurantId: uuid,
    customerId: uuid,
    type: { type: "string", enum: ["credit", "debit", "correction", "write_off"] },
    amount: { type: "number", exclusiveMinimum: 0, maximum: 100000000 },
    reason: { type: "string", minLength: 1, maxLength: 500 },
    notes: { type: "string", maxLength: 2000, nullable: true },
    /** When the adjustment happened (defaults to now; never the future). */
    createdAt: { type: "string", format: "date-time", nullable: true },
  },
} as const;
export interface AdjustmentInput {
  restaurantId: string;
  customerId: string;
  type: "credit" | "debit" | "correction" | "write_off";
  amount: number;
  reason: string;
  notes?: string | null;
  createdAt?: string | null;
}

export const revertBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  properties: { restaurantId: uuid },
} as const;
