import { db } from "@/integrations/db/client";

export interface AiIncomeJournalResult {
  posted: boolean;
  /** True when AI confidence was too low; nothing posted, user must confirm `account`. */
  needs_review?: boolean;
  message?: string;
  ledger_batch_id?: string;
  account: { id: string; code: string; name: string };
  confidence: number;
  classification: string;
  rationale: string;
}

export class AiIncomeNeedsReviewError extends Error {
  constructor(public result: AiIncomeJournalResult) {
    super(result.message || "AI suggestion needs review");
  }
}

async function invoke(body: Record<string, unknown>): Promise<AiIncomeJournalResult> {
  const { data, error } = await db.functions.invoke("generate-income-journal", { body });
  if (error) {
    const context = error.context as Response | undefined;
    let message = error.message;
    if (context) {
      const payload = await context.clone().json().catch(() => null);
      message = payload?.error || message;
    }
    throw new Error(message);
  }
  return data as AiIncomeJournalResult;
}

/** Posts a sales day. Throws AiIncomeNeedsReviewError when the AI is unsure. */
export async function postSalesWithAi(salesId: string): Promise<AiIncomeJournalResult> {
  const result = await invoke({ sales_id: salesId });
  if (result.needs_review) throw new AiIncomeNeedsReviewError(result);
  return result;
}

/** Posts a sales day to an account the user explicitly confirmed. */
export function postSalesToConfirmedAccount(salesId: string, accountId: string) {
  return invoke({ sales_id: salesId, confirm_account_id: accountId });
}
