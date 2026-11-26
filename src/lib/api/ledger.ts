/**
 * Manual journal entries: /api/v1/ledger/* (server/src/modules/ledger). The server checks the
 * entry balances, posts it (owner/manager) or queues it for approval (accountant), and voids or
 * reverses whole entries. Browsers no longer write ledger lines directly.
 */
import { apiRequest } from "./http";

export type JournalEntryType = "adjustment" | "correction" | "reversal" | "opening_balance";

export interface JournalEntryResult {
  id: string;
  status: "posted" | "pending" | "voided";
  date: string;
  totalDebit: number;
  lineCount: number;
  reversalOf?: string;
}

export async function createJournalEntry(input: {
  restaurantId: string;
  date: string;
  description: string;
  entryType?: JournalEntryType;
  referenceNumber?: string | null;
  branchId?: string | null;
  lines: { accountId: string; debit?: number | null; credit?: number | null; description?: string | null }[];
}) {
  const { data } = await apiRequest<JournalEntryResult>("/ledger/journal-entries", { body: input });
  return data;
}

export async function voidJournalEntry(batchId: string, input: { restaurantId: string; reason: string }) {
  const { data } = await apiRequest<JournalEntryResult>(`/ledger/journal-entries/${batchId}/void`, { body: input });
  return data;
}

export async function reverseJournalEntry(batchId: string, input: { restaurantId: string; reason: string; date?: string }) {
  const { data } = await apiRequest<JournalEntryResult>(`/ledger/journal-entries/${batchId}/reverse`, { body: input });
  return data;
}
