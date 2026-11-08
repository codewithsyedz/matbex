/**
 * Parses Postgres ledger-validation failures raised by the accounting triggers
 * (validate_journal_entry_accounts, expense balance guards, branch guards) into
 * a structured, human-readable explanation that can be surfaced directly in the
 * "Mark as Paid" flow instead of a generic "Failed to update expense" toast.
 */

export interface ParsedLedgerValidationError {
  /** True when the failure came from a ledger validation rule (not a generic error). */
  isLedgerValidation: boolean;
  /** Machine code, e.g. VALIDATION_ERROR, BRANCH_REQUIRED, UNBALANCED. */
  code: string;
  /** Short headline for the alert. */
  title: string;
  /** The exact rule text raised by the database, verbatim. */
  detail: string;
  /** Account code mentioned by the rule, when present (e.g. "2000"). */
  accountCode?: string;
  /** Account name mentioned by the rule, when present. */
  accountName?: string;
  /** Account type mentioned by the rule, when present (e.g. "liability"). */
  accountType?: string;
  /** Which side of the entry was rejected, when the rule says so. */
  legSide?: "debit" | "credit";
  /** The kind of batch that was rejected, e.g. "expense", "sales", "consumption". */
  entryType?: string;
  /** Human name of the rule that fired, e.g. "Expense debit account rule". */
  ruleName?: string;
  /** Account ranges the rule accepts, e.g. ["6000-6999", "5000-5999"]. */
  allowedRanges?: string[];
  /** Actionable next step for the user. */
  fix: string;
}

function messageOf(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  const e = err as { message?: string; details?: string; hint?: string };
  return [e.message, e.details, e.hint].filter(Boolean).join(" — ");
}

const CODES = [
  "VALIDATION_ERROR",
  "BRANCH_REQUIRED",
  "VAT_CONFIG_ERROR",
  "UNBALANCED",
  "PERIOD_LOCKED",
  "AP_SETTLEMENT_LOCKED",
] as const;

function fixFor(code: string, detail: string, accountCode?: string): string {
  const d = detail.toLowerCase();
  if (code === "BRANCH_REQUIRED") {
    return "Assign a branch to this expense (and its category account) before settling it.";
  }
  if (code === "VAT_CONFIG_ERROR") {
    if (d.includes("no branch is attached")) {
      return "Assign a branch to this record so the correct VAT rate can be applied.";
    }
    if (d.includes("2200")) {
      return "Add or reactivate account 2200 VAT Payable in Accounting → Chart of Accounts, then post again.";
    }
    if (d.includes("does not match")) {
      return "Correct the VAT amount on the shift summary, or update the branch VAT rate in Settings → Branches, then post again.";
    }
    return "Set a valid VAT rate (0–100) for this branch in Settings → Branches, then post again.";
  }
  if (code === "PERIOD_LOCKED") {
    return "The fiscal period is closed. Ask an accountant to reopen the period, or date the settlement in an open period.";
  }
  if (code === "AP_SETTLEMENT_LOCKED") {
    return "This settlement is already posted and immutable. Use the reversal action instead of editing it.";
  }
  if (d.includes("debit") && d.includes("credit") && d.includes("balance")) {
    return "The settlement legs don't balance. Check the paid amount against the bill total.";
  }
  if (d.includes("inventory")) {
    return "Inventory accounts (1200-1299) can't be used on an expense entry — record it as a purchase, or point the category at an expense account.";
  }
  if (accountCode && accountCode >= "2000" && accountCode < "3000") {
    return "Accounts Payable is only valid as the settlement debit. If this bill was paid directly, choose a cash or bank funding account instead.";
  }
  if (d.includes("expense debit entries")) {
    return "Point this expense category at an Expense (6000-6999) or COGS (5000-5999) account in the Chart of Accounts, then retry.";
  }
  if (d.includes("funding") || d.includes("payable or funding account not found")) {
    return "Select a funding account (company cash/bank or a partner capital account) for this payment.";
  }
  return "Fix the account mapping shown above in the Chart of Accounts, then mark the bill paid again.";
}

function legSideOf(detail: string): "debit" | "credit" | undefined {
  const d = detail.toLowerCase();
  if (/debit(ed)?\b/.test(d) && !/credit/.test(d)) return "debit";
  if (/credit(ed)?\b/.test(d) && !/debit/.test(d)) return "credit";
  if (/debit entries/.test(d)) return "debit";
  if (/credit entries/.test(d)) return "credit";
  return undefined;
}

function entryTypeOf(detail: string): string | undefined {
  const d = detail.toLowerCase();
  const explicit = detail.match(/from a "([a-z_]+)" entry/i);
  if (explicit) return explicit[1];
  if (d.startsWith("expense")) return "expense";
  if (d.startsWith("sales")) return "sales";
  if (d.startsWith("cogs") || d.includes("consumption")) return "consumption";
  if (d.startsWith("purchase")) return "purchase";
  return undefined;
}

function ruleNameOf(detail: string, side?: "debit" | "credit", entryType?: string): string {
  const d = detail.toLowerCase();
  if (d.includes("partner loan") || d.includes("partner funding") || d.includes("capital account")) {
    return "Partner funding cannot be revenue or an expense";
  }
  if (d.includes("fixed asset account")) {
    return "Fixed assets must go through the Fixed Asset Register";
  }
  if (d.includes("inventory account")) {
    return "Inventory accounts are reserved for purchase / consumption entries";
  }
  if (d.includes("unbalanced") || (d.includes("debit") && d.includes("credit") && d.includes("balance"))) {
    return "Every entry must balance (total debits = total credits)";
  }
  if (side && entryType) {
    return `Allowed ${side} accounts for ${entryType} entries`;
  }
  return "Chart of accounts posting rule";
}

/** Pulls "(1000-1199)" style ranges out of the rule text, in order. */
function allowedRangesOf(detail: string): string[] {
  const out: string[] = [];
  const re = /\((\d{4})\s*-\s*(\d{4})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(detail))) {
    const range = `${m[1]}-${m[2]}`;
    if (!out.includes(range)) out.push(range);
  }
  return out;
}

export function parseLedgerValidationError(
  err: unknown,
): ParsedLedgerValidationError {
  const raw = messageOf(err).trim();
  const code = CODES.find((c) => raw.toUpperCase().includes(c));

  if (!code) {
    return {
      isLedgerValidation: false,
      code: "ERROR",
      title: "Could not mark this bill as paid",
      detail: raw || "Unknown error",
      fix: "Retry, and if it keeps failing check the expense's account and branch mapping.",
    };
  }

  // Strip the "CODE:" prefix so the alert body reads as plain guidance.
  const detail =
    raw.replace(new RegExp(`^[\\s\\S]*?${code}:\\s*`, "i"), "").trim() || raw;

  const acct = detail.match(/"(\d{4})\s*-\s*([^"]+)"/);
  const type = detail.match(/type\s+"([a-z_]+)"/i);
  const accountCode = acct?.[1];
  const legSide = legSideOf(detail);
  const entryType = entryTypeOf(detail);

  return {
    isLedgerValidation: true,
    code,
    title:
      code === "BRANCH_REQUIRED"
        ? "Branch is required on this ledger entry"
        : code === "VAT_CONFIG_ERROR"
          ? "Branch VAT rate is missing or inconsistent"
          : code === "PERIOD_LOCKED"
          ? "Fiscal period is locked"
          : legSide && accountCode
            ? `Ledger rejected the ${legSide} leg on ${accountCode}${acct?.[2] ? ` · ${acct[2].trim()}` : ""}`
            : "Ledger validation rule blocked this posting",
    detail,
    accountCode,
    accountName: acct?.[2]?.trim(),
    accountType: type?.[1],
    legSide,
    entryType,
    ruleName: ruleNameOf(detail, legSide, entryType),
    allowedRanges: allowedRangesOf(detail),
    fix: fixFor(code, detail, accountCode),
  };
}
