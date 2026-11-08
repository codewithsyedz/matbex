/**
 * Client-side mirror of the database posting guards.
 *
 * These rules exist as PL/pgSQL triggers (the real enforcement); duplicating
 * them here lets the UI block a bad save before the user loses their form.
 * Keep the two in sync — see `validate_journal_entry_accounts`,
 * `enforce_expense_not_fixed_asset` and `enforce_partner_account_classification`.
 */

export interface PostingAccount {
  id?: string;
  account_code: string;
  account_name: string;
  account_type: string;
  is_fixed_asset_account?: boolean | null;
}

export interface RuleViolation {
  rule: "partner_funding_as_revenue" | "expense_to_fixed_asset" | "partner_account_as_expense";
  message: string;
  /** Short headline for the alert, e.g. "Partner funding can't be revenue". */
  title: string;
  /** Plain-language reason the accounting rule exists. */
  why: string;
  /** The account(s) that triggered the rule, so the user knows what to change. */
  offending: { label: string; note: string }[];
  /** Concrete, ordered ways out of the error. */
  fixes: PostingRuleFix[];
}

export interface PostingRuleFix {
  label: string;
  detail: string;
  /** In-app destination that resolves the problem, when one exists. */
  route?: string;
}

const inRange = (code: string, from: string, to: string) => code >= from && code < to;

/** Partner loan / capital / current-account codes and names. */
export function isPartnerFundingAccount(account: PostingAccount): boolean {
  const code = account.account_code ?? "";
  if (inRange(code, "2400", "2430")) return true;
  if (inRange(code, "3400", "3500")) return true;
  const name = (account.account_name ?? "").toLowerCase();
  const who = /(partner|owner|shareholder|director)/.test(name);
  const what = /(loan|advance|capital|current account|payable|funding)/.test(name);
  return who && what;
}

export function isRevenueAccount(account: PostingAccount): boolean {
  return account.account_type === "revenue" || inRange(account.account_code ?? "", "4000", "5000");
}

export function isFixedAssetAccount(account: PostingAccount): boolean {
  return (
    account.is_fixed_asset_account === true ||
    inRange(account.account_code ?? "", "1500", "1600")
  );
}

const label = (a: PostingAccount) => `${a.account_code} · ${a.account_name}`;

const TYPE_WORDS: Record<string, string> = {
  asset: "an asset",
  liability: "a liability",
  equity: "equity",
  revenue: "revenue (income)",
  cogs: "cost of goods sold",
  expense: "an expense",
};
const typeWord = (t: string) => TYPE_WORDS[t] ?? `"${t}"`;

/**
 * Partner funding can never be classified as, or posted alongside, revenue.
 * Pass every account in the journal entry.
 */
export function checkPartnerFundingNotRevenue(accounts: PostingAccount[]): RuleViolation | null {
  const partner = accounts.find(isPartnerFundingAccount);
  if (!partner) return null;

  if (partner.account_type !== "liability" && partner.account_type !== "equity") {
    return {
      rule: "partner_funding_as_revenue",
      title: "Partner funding account has the wrong account type",
      message: `"${label(partner)}" is a partner loan/capital account but is classified as "${partner.account_type}". Partner funding must sit in a liability (loan) or equity (capital) account — it is never revenue.`,
      why:
        "Money a partner puts into the business is financing, not earnings. Booking it as income would inflate your sales, overstate profit and VAT, and hide the fact that the money is still owed back to the partner.",
      offending: [
        {
          label: label(partner),
          note: `Currently classified as ${typeWord(partner.account_type)} — it reads as a partner loan/capital account.`,
        },
      ],
      fixes: [
        {
          label: "Set the type to Liability if the partner expects the money back",
          detail:
            "Repayable partner money is a loan. Use a code in the 2400-2429 range (Partner / Director Loans).",
          route: "/accounting/chart-of-accounts",
        },
        {
          label: "Set the type to Equity if it is a permanent capital injection",
          detail:
            "Capital that stays in the business belongs in 3400-3499 (Partner Capital Accounts) and is managed from the Owner Capital screen.",
          route: "/accounting/owner-capital",
        },
        {
          label: "Rename the account if it is genuinely a sales account",
          detail:
            'The rule triggers on names containing partner/owner wording plus loan/capital/advance. If this is real income, drop those words and use a 4000-4999 code.',
          route: "/accounting/chart-of-accounts",
        },
      ],
    };
  }

  const revenue = accounts.find((a) => a !== partner && isRevenueAccount(a));
  if (revenue) {
    return {
      rule: "partner_funding_as_revenue",
      title: "Partner funding and revenue can't share one journal entry",
      message: `"${label(partner)}" cannot be posted in the same entry as revenue account "${label(revenue)}". A partner loan or capital injection is financing, not sales income — post it against Cash/Bank and the partner account only.`,
      why:
        "Mixing the two legs turns a balance-sheet transfer into an income statement entry. Your P&L would show sales that never happened, and the partner balance would never reconcile with what the business actually owes.",
      offending: [
        { label: label(partner), note: "Partner loan / capital account (balance sheet)." },
        { label: label(revenue), note: "Revenue account (profit & loss)." },
      ],
      fixes: [
        {
          label: "Post the funding as Cash/Bank against the partner account",
          detail:
            "Debit 1000 Cash in Hand or 1010 Bank, credit the partner loan/capital account. No revenue line is involved.",
          route: "/accounting/owner-capital",
        },
        {
          label: "Split it into two entries if the sheet mixed two events",
          detail:
            "Record the sale on its own (Cash/Bank against revenue) and the partner injection on its own. Never combine them in one batch.",
        },
        {
          label: "Swap the revenue line for the correct account",
          detail:
            "If the partner paid a supplier directly, the other leg is the expense or asset that was bought — not a revenue account.",
        },
      ],
    };
  }
  return null;
}

export interface CapexContext {
  /** Linked to a project / cost centre acquisition. */
  projectId?: string | null;
  /** Created through the Fixed Asset Register (capitalisation flow). */
  viaFixedAssetRegister?: boolean;
  /** Opening balances and corrections are allowed to touch asset accounts. */
  isOpeningBalanceOrAdjustment?: boolean;
}

/** An expense may not be charged to a fixed asset account without a capitalisation flag. */
export function checkExpenseNotFixedAsset(
  account: PostingAccount | null | undefined,
  ctx: CapexContext = {},
): RuleViolation | null {
  if (!account) return null;

  if (isPartnerFundingAccount(account)) {
    return {
      rule: "partner_account_as_expense",
      title: "That's a partner account, not an expense account",
      message: `"${label(account)}" is a partner loan/capital account and cannot be used as an expense account. Use the Owner Capital screen for partner injections and withdrawals.`,
      why:
        "Charging a cost to a partner account would treat the partner's balance as a business expense. The cost would vanish from your P&L and the partner ledger would drift away from what is really owed.",
      offending: [
        { label: label(account), note: "Partner loan / capital account (balance sheet, 2400-2429 or 3400-3499)." },
      ],
      fixes: [
        {
          label: "Pick the expense account for what was actually bought",
          detail:
            "Use a 6000-6999 operating expense account (rent, utilities, repairs, salaries) or a 5000-5999 COGS account for food and packaging.",
        },
        {
          label: "If the partner paid personally, keep the expense account and change the funding source",
          detail:
            'Select "Paid by Owner / Partner Account" in the funding dialog. The system credits the partner account for you and the cost still lands in the right expense line.',
        },
        {
          label: "If this is a withdrawal, not a cost, record it as capital",
          detail: "Drawings and injections belong on the Owner Capital screen, not in Expenses.",
          route: "/accounting/owner-capital",
        },
      ],
    };
  }

  if (!isFixedAssetAccount(account)) return null;

  const allowed =
    Boolean(ctx.projectId) ||
    ctx.viaFixedAssetRegister === true ||
    ctx.isOpeningBalanceOrAdjustment === true;

  if (allowed) return null;

  return {
    rule: "expense_to_fixed_asset",
    title: "Fixed asset accounts can't be used on a plain expense",
    message: `"${label(account)}" is a fixed asset account. An expense cannot be capitalised this way — record the purchase in the Fixed Asset Register (so the asset and its depreciation schedule are created), link it to a project / cost centre, or pick an expense account (6000-6999) if it is below the capitalisation threshold.`,
    why:
      "Anything debited to 1500-1599 becomes an asset that must be depreciated over its useful life. Posting straight from Expenses creates an asset with no register entry, no useful life and no depreciation — so your balance sheet grows and your profit is overstated every month.",
    offending: [
      { label: label(account), note: "Fixed asset account (1500-1599) — depreciable, not a running cost." },
    ],
    fixes: [
      {
        label: "Record it in the Fixed Asset Register instead",
        detail:
          "Use this for equipment, fit-out and vehicles above the capitalisation threshold. The register creates the asset, its useful life and the monthly depreciation posting automatically.",
        route: "/accounting/fixed-assets",
      },
      {
        label: "Use an expense account if it is below the threshold",
        detail:
          "Small tools, utensils and minor repairs go to 6300 Repairs & Maintenance or another 6000-6999 account and are written off immediately.",
      },
      {
        label: "Link it to a project / cost centre for work in progress",
        detail:
          "Acquisition and fit-out spend on an ongoing project is capitalised to 1550 CIP through the project acquisition screen, then transferred to the asset register at handover.",
        route: "/projects",
      },
    ],
  };
}

/**
 * Database triggers enforce the same rules server-side, but their messages are
 * written for engineers. Translate a caught Postgres error into the same
 * structured explanation the UI shows for client-side checks.
 */
export function explainPostingError(error: unknown): RuleViolation | null {
  const raw =
    typeof error === "string"
      ? error
      : ((error as { message?: string } | null)?.message ?? "");
  if (!raw) return null;
  const text = raw.toLowerCase();

  const generic = (
    rule: RuleViolation["rule"],
    title: string,
    why: string,
    fixes: PostingRuleFix[],
  ): RuleViolation => ({
    rule,
    title,
    message: raw,
    why,
    offending: [{ label: "Reported by the ledger", note: raw }],
    fixes,
  });

  if (text.includes("fixed asset") || text.includes("1500")) {
    return generic(
      "expense_to_fixed_asset",
      "The ledger blocked this as an uncapitalised asset purchase",
      "The debit account is a fixed asset account, so the ledger refused to create an asset that has no register entry and no depreciation schedule behind it.",
      [
        {
          label: "Record it in the Fixed Asset Register",
          detail: "Creates the asset, useful life and monthly depreciation in one step.",
          route: "/accounting/fixed-assets",
        },
        {
          label: "Or choose a 6000-6999 expense account",
          detail: "Correct when the purchase is below your capitalisation threshold.",
        },
      ],
    );
  }

  if (text.includes("partner") || text.includes("2410") || text.includes("3400")) {
    return generic(
      "partner_funding_as_revenue",
      "The ledger blocked a partner funding account on this entry",
      "Partner loans and capital sit on the balance sheet. The ledger will not let them be typed as revenue or posted alongside a revenue line.",
      [
        {
          label: "Post partner money through Owner Capital",
          detail: "Injections and withdrawals are recorded there against Cash/Bank.",
          route: "/accounting/owner-capital",
        },
        {
          label: "Or correct the account type",
          detail: "Repayable money is a liability (2400-2429); permanent capital is equity (3400-3499).",
          route: "/accounting/chart-of-accounts",
        },
      ],
    );
  }

  if (text.includes("expense or cogs") || text.includes("validation_error")) {
    return generic(
      "expense_to_fixed_asset",
      "The debit account doesn't match this entry type",
      "An expense batch must debit an expense (6000-6999) or COGS (5000-5999) account — the only exception is an accounts-payable settlement, which debits 2100.",
      [
        {
          label: "Choose the expense or COGS account for what was bought",
          detail: "Food and packaging go to COGS; running costs go to operating expenses.",
        },
        {
          label: "Check the ledger mapping for this category",
          detail: "A category mapped to the wrong account will keep producing this error on every entry.",
          route: "/accounting/ledger-mapping",
        },
      ],
    );
  }

  return null;
}
