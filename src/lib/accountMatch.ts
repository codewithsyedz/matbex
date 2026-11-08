/**
 * Resolves free-text spreadsheet values ("5100", "5100 - Kitchen Equipment",
 * "kitchen equipment") to a chart_of_accounts entry so imported rows can carry
 * a real debit account before anything is posted to the ledger.
 */
import type { ChartOfAccount } from "@/hooks/useChartOfAccounts";

export type AccountMatchConfidence = "code" | "code_name" | "name" | "fuzzy" | "none";

export interface AccountMatch {
  account: ChartOfAccount | null;
  confidence: AccountMatchConfidence;
  /** Other plausible accounts when the text was ambiguous. */
  candidates: ChartOfAccount[];
  reason: string;
}

const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Pulls a leading account code out of "5100 - Kitchen Equipment" style text. */
export function extractAccountCode(raw: string): string | null {
  const m = raw.trim().match(/^(\d{3,6})\b/);
  return m ? m[1] : null;
}

export function matchAccount(raw: string, accounts: ChartOfAccount[]): AccountMatch {
  const text = (raw ?? "").trim();
  const usable = accounts.filter((a) => a.is_active !== false);
  if (!text) {
    return { account: null, confidence: "none", candidates: [], reason: "No account value in this row" };
  }

  const code = extractAccountCode(text);
  if (code) {
    const byCode = usable.filter((a) => a.account_code === code);
    if (byCode.length === 1) {
      const rest = norm(text.slice(code.length));
      return {
        account: byCode[0],
        confidence: rest && norm(byCode[0].account_name) === rest ? "code_name" : "code",
        candidates: [],
        reason: `Matched account code ${code}`,
      };
    }
    if (byCode.length > 1) {
      return {
        account: null,
        confidence: "none",
        candidates: byCode,
        reason: `Account code ${code} matches ${byCode.length} accounts`,
      };
    }
  }

  const target = norm(text);
  const exact = usable.filter((a) => norm(a.account_name) === target);
  if (exact.length === 1) {
    return { account: exact[0], confidence: "name", candidates: [], reason: "Matched account name" };
  }
  if (exact.length > 1) {
    return {
      account: null,
      confidence: "none",
      candidates: exact,
      reason: `“${text}” matches ${exact.length} accounts by name`,
    };
  }

  const partial = usable.filter(
    (a) => norm(a.account_name).includes(target) || target.includes(norm(a.account_name)),
  );
  if (partial.length === 1) {
    return {
      account: partial[0],
      confidence: "fuzzy",
      candidates: [],
      reason: `Closest name match — confirm before posting`,
    };
  }
  if (partial.length > 1) {
    return {
      account: null,
      confidence: "none",
      candidates: partial.slice(0, 8),
      reason: `“${text}” is ambiguous (${partial.length} similar accounts)`,
    };
  }

  return {
    account: null,
    confidence: "none",
    candidates: [],
    reason: code
      ? `No account with code ${code} exists in the chart`
      : `No account matches “${text}”`,
  };
}

/** Accounts that may legitimately receive the debit side of an imported spend row. */
export function isDebitableAccount(a: ChartOfAccount): boolean {
  return a.account_type === "expense" || a.account_type === "cogs" || a.account_type === "asset";
}

export const MATCH_LABELS: Record<AccountMatchConfidence, string> = {
  code: "Code",
  code_name: "Code + name",
  name: "Name",
  fuzzy: "Best guess",
  none: "Unmatched",
};
