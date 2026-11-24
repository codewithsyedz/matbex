/**
 * Request/response contract for /api/v1/pos/checks (open checks / running tabs,
 * docs/plans/open-checks.md). Line and tender shapes are the ones POST /api/v1/pos/sales takes.
 */
import { createSaleBody, type CreateSaleInput, type CreateSaleResult } from "./sales.schema.js";
import { billSplitBody, type BillSplitResult } from "./bill-split.schema.js";

const uuid = { type: "string", format: "uuid" } as const;
const p = createSaleBody.properties;

/** A line added to a check: a menu item or a combo, the price the terminal showed, a note. */
const lineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quantity"],
  oneOf: [{ required: ["menuItemId"] }, { required: ["comboId"] }],
  properties: {
    menuItemId: uuid,
    comboId: uuid,
    size: { type: "string", enum: ["regular", "quarter", "half", "full"], default: "regular" },
    quantity: { type: "integer", minimum: 1, maximum: 1000 },
    unitPrice: { type: "number", minimum: 0, maximum: 1000000 },
    note: { type: "string", maxLength: 300, nullable: true },
  },
} as const;

const lines = { type: "array", minItems: 1, maxItems: 200, items: lineSchema } as const;
/** The check version the terminal last saw; a newer one on the server gives 409 check_changed. */
const expectedVersion = { type: "integer", minimum: 1 } as const;

export const checkParams = {
  type: "object",
  required: ["id"],
  properties: { id: uuid },
} as const;

export const lineParams = {
  type: "object",
  required: ["id", "lineId"],
  properties: { id: uuid, lineId: uuid },
} as const;

export const restaurantBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  properties: { restaurantId: uuid, expectedVersion },
} as const;

export const listQuery = {
  type: "object",
  required: ["restaurantId"],
  properties: {
    restaurantId: uuid,
    branchId: uuid,
    status: { type: "string", enum: ["open"], default: "open" },
  },
} as const;

export const getQuery = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: uuid },
} as const;

export const openBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  properties: {
    restaurantId: uuid,
    branchId: { ...uuid, nullable: true },
    tableId: { ...uuid, nullable: true },
    name: { type: "string", maxLength: 80, nullable: true },
    guestCount: { type: "integer", minimum: 1, maximum: 500, nullable: true },
    customerId: { ...uuid, nullable: true },
    notes: { type: "string", maxLength: 500, nullable: true },
    /** Lines to add right away ("Send to kitchen" from the POS cart). */
    lines: { ...lines, minItems: 0 },
    /** Send the lines to the kitchen in the same request. */
    send: { type: "boolean", default: false },
  },
} as const;

export const addLinesBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "lines"],
  properties: { restaurantId: uuid, expectedVersion, lines, send: { type: "boolean", default: false } },
} as const;

export const editLineBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  properties: {
    restaurantId: uuid,
    expectedVersion,
    quantity: { type: "integer", minimum: 1, maximum: 1000 },
    note: { type: "string", maxLength: 300, nullable: true },
  },
} as const;

const adminPin = { type: "string", pattern: "^[0-9]{4,12}$", nullable: true } as const;

/**
 * Void a line (or `quantity` of its units) or a whole check. Items already sent to the kitchen
 * need a reason and a manager, or anyone with the admin PIN (`adminPin`).
 */
export const voidBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  properties: {
    restaurantId: uuid,
    expectedVersion,
    reason: { type: "string", maxLength: 500, nullable: true },
    quantity: { type: "integer", minimum: 1, maximum: 1000 },
    adminPin,
  },
} as const;

export const moveBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "tableId"],
  properties: { restaurantId: uuid, expectedVersion, tableId: uuid },
} as const;

export const mergeBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "fromCheckId"],
  properties: { restaurantId: uuid, expectedVersion, fromCheckId: uuid },
} as const;

export const serviceChargeBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "waived"],
  properties: { restaurantId: uuid, expectedVersion, waived: { type: "boolean" }, reason: { type: "string", maxLength: 500, nullable: true }, adminPin },
} as const;

export const reportQuery = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: uuid, branchId: uuid, day: { type: "string", format: "date" } },
} as const;

/**
 * Pay a check: `payments` (one sale; one or more tenders) or `parts` (split bill by item:
 * the parts must be exactly the check's lines, see /pos/sales/bill-split).
 */
export const payBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId"],
  oneOf: [{ required: ["payments"] }, { required: ["parts"] }],
  properties: {
    restaurantId: uuid,
    expectedVersion,
    shiftId: p.shiftId,
    customerId: p.customerId,
    payments: p.payments,
    parts: billSplitBody.properties.parts,
  },
  definitions: createSaleBody.definitions,
} as const;

export type CheckLineInput = {
  menuItemId?: string;
  comboId?: string;
  size?: "regular" | "quarter" | "half" | "full";
  quantity: number;
  unitPrice?: number;
  note?: string | null;
};

export interface OpenCheckInput {
  restaurantId: string;
  branchId?: string | null;
  tableId?: string | null;
  name?: string | null;
  guestCount?: number | null;
  customerId?: string | null;
  notes?: string | null;
  lines?: CheckLineInput[];
  send?: boolean;
}

export interface AddLinesInput {
  restaurantId: string;
  expectedVersion?: number;
  lines: CheckLineInput[];
  send?: boolean;
}

export interface EditLineInput {
  restaurantId: string;
  expectedVersion?: number;
  quantity?: number;
  note?: string | null;
}

export interface VoidInput {
  restaurantId: string;
  expectedVersion?: number;
  reason?: string | null;
  quantity?: number;
  adminPin?: string | null;
}

export interface PayCheckInput {
  restaurantId: string;
  expectedVersion?: number;
  shiftId?: string | null;
  customerId?: string | null;
  payments?: CreateSaleInput["payments"];
  parts?: { lines: CreateSaleInput["lines"]; payments?: CreateSaleInput["payments"] }[];
}

export interface CheckLine {
  id: string;
  menuItemId: string | null;
  comboId: string | null;
  name: string;
  size: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  note: string | null;
  roundNumber: number | null;
  status: "active" | "voided";
  createdAt: string;
}

export interface CheckSummary {
  id: string;
  checkNumber: string;
  name: string | null;
  status: "open" | "paid" | "void" | "merged";
  branchId: string | null;
  tableId: string | null;
  tableLabel: string | null;
  guestCount: number | null;
  serverId: string | null;
  openedAt: string;
  version: number;
  /** Active lines, at their stored prices. */
  itemCount: number;
  unsentCount: number;
  /** Active lines at their stored prices (listed). */
  linesTotal: number;
  /** Branch service charge (percent of the lines), 0 when off or waived; included in total. */
  serviceChargePercent: number;
  serviceCharge: number;
  serviceChargeWaived: boolean;
  subtotal: number;
  tax: number;
  total: number;
}

export interface CheckDetail extends CheckSummary {
  customerId: string | null;
  notes: string | null;
  serviceChargeWaiveReason: string | null;
  lines: CheckLine[];
  rounds: { id: string; number: number; sentAt: string; kdsTicketId: string | null }[];
}

export interface PayCheckResult {
  check: CheckDetail;
  /** One sale (payments) or one per part (split bill). */
  sales: CreateSaleResult[];
  billGroupId: string | null;
  replayed?: boolean;
}

export type { BillSplitResult };
