/**
 * Manual journal entry contracts (validated by Fastify's AJV):
 *   POST /api/v1/ledger/journal-entries               post (owner/manager) or submit for approval (accountant)
 *   POST /api/v1/ledger/journal-entries/:id/void      void the whole entry while its period is open
 *   POST /api/v1/ledger/journal-entries/:id/reverse   post a mirror entry in an open period
 *
 * Amounts are SAR with two decimals. Each line has a debit or a credit, never both.
 */
const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const amount = { type: "number", minimum: 0, maximum: 1_000_000_000 } as const;

/** "reversal" here is a label on a hand-written entry; linked reversals come from /:id/reverse. */
export const ENTRY_TYPES = ["adjustment", "correction", "reversal", "opening_balance"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const idParams = { type: "object", required: ["id"], properties: { id: uuid } } as const;

export const createJournalBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "date", "description", "lines"],
  properties: {
    restaurantId: uuid,
    date,
    description: { type: "string", minLength: 1, maxLength: 500 },
    entryType: { type: "string", enum: ENTRY_TYPES },
    referenceNumber: { type: "string", maxLength: 100, nullable: true },
    branchId: { ...uuid, nullable: true },
    lines: {
      type: "array",
      minItems: 2,
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["accountId"],
        properties: {
          accountId: uuid,
          debit: { ...amount, nullable: true },
          credit: { ...amount, nullable: true },
          description: { type: "string", maxLength: 500, nullable: true },
        },
      },
    },
  },
} as const;

export interface JournalLineInput {
  accountId: string;
  debit?: number | null;
  credit?: number | null;
  description?: string | null;
}
export interface CreateJournalInput {
  restaurantId: string;
  date: string;
  description: string;
  entryType?: EntryType;
  referenceNumber?: string | null;
  branchId?: string | null;
  lines: JournalLineInput[];
}

export const voidBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "reason"],
  properties: {
    restaurantId: uuid,
    reason: { type: "string", minLength: 3, maxLength: 500 },
  },
} as const;
export interface VoidInput {
  restaurantId: string;
  reason: string;
}

export const reverseBody = {
  type: "object",
  additionalProperties: false,
  required: ["restaurantId", "reason"],
  properties: {
    restaurantId: uuid,
    reason: { type: "string", minLength: 3, maxLength: 500 },
    /** Date of the reversing entry; defaults to today in the restaurant's timezone. */
    date,
  },
} as const;
export interface ReverseInput {
  restaurantId: string;
  reason: string;
  date?: string;
}

export interface JournalEntryResult {
  id: string;
  status: "posted" | "pending" | "voided";
  date: string;
  totalDebit: number;
  lineCount: number;
  reversalOf?: string;
}
