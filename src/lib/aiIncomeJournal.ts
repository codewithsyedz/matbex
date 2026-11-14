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

/**
 * A day whose revenue account a person has to confirm (the AI was unsure or unavailable):
 * a toast with "Confirm & post". Bulk flows never confirm on the user's behalf.
 */
export function promptConfirmSalesAccount(
  salesId: string,
  s: AiIncomeJournalResult,
  toastApi: { warning: (m: string, o?: any) => unknown; success: (m: string) => unknown; error: (m: string) => unknown },
  onPosted?: () => void,
) {
  toastApi.warning(`Please confirm: post to ${s.account.code} · ${s.account.name}?`, {
    description: s.confidence > 0 ? `AI was only ${Math.round(s.confidence * 100)}% sure. ${s.rationale}` : s.rationale,
    duration: 30000,
    action: {
      label: "Confirm & post",
      onClick: async () => {
        try {
          await postSalesToConfirmedAccount(salesId, s.account.id);
          toastApi.success(`Posted to ${s.account.code} · ${s.account.name}`);
          onPosted?.();
        } catch (e: any) {
          toastApi.error(e?.message ?? "Posting failed");
        }
      },
    },
  });
}
