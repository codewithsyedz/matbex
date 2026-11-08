/**
 * Which chart-of-accounts rows may be used as the paying (credit) account when
 * settling an expense.
 *
 * Mirrors the database guard `public.is_cash_or_bank_account`: only real cash /
 * bank accounts in the 1000-1099 asset range qualify. Other current assets in
 * that range — staff advances (1150), card settlements receivable (1015),
 * prepaids, input VAT, inventory, clearing accounts — are NOT payment sources.
 * Crediting them silently books a vendor payment against, e.g., an employee
 * advance instead of cash.
 */

export const NON_PAYMENT_ASSET_PATTERN =
  /(advance|receivable|prepaid|vat|inventory|deposit paid|settlement|clearing)/i;

export interface AccountLike {
  id?: string;
  account_code?: string | null;
  account_name?: string | null;
  account_type?: string | null;
  is_active?: boolean | null;
}

/** True when the account is a genuine cash or bank account (code 1000-1099). */
export function isCashOrBankAccount(account?: AccountLike | null): boolean {
  if (!account) return false;
  if (account.account_type !== "asset") return false;
  const code = String(account.account_code ?? "");
  if (!(code >= "1000" && code < "1100")) return false;
  const name = String(account.account_name ?? "");
  if (NON_PAYMENT_ASSET_PATTERN.test(name)) return false;
  return /cash|bank/i.test(name);
}

/** Accounts that may be offered in a "which account is paying?" picker. */
export function selectablePaymentAccounts<T extends AccountLike>(
  accounts: T[] | null | undefined
): T[] {
  return (accounts ?? []).filter((a) => a.is_active !== false && isCashOrBankAccount(a));
}

export function accountLabel(account?: AccountLike | null): string {
  if (!account) return "the selected account";
  return [account.account_code, account.account_name].filter(Boolean).join(" ");
}

export interface PaymentAccountIssue {
  title: string;
  detail: string;
  suggestion: string;
}

/**
 * Validate a chosen payment_account_id before saving an expense. Returns null
 * when the selection is acceptable.
 */
export function validatePaymentAccount(
  accountId: string | null | undefined,
  accounts: AccountLike[] | null | undefined,
  opts: { required?: boolean } = {}
): PaymentAccountIssue | null {
  if (!accountId) {
    return opts.required
      ? {
          title: "Paying account is required",
          detail: "A paid bill must credit a cash or bank account.",
          suggestion: "Choose the cash or bank account the money left from.",
        }
      : null;
  }
  const account = (accounts ?? []).find((a) => a.id === accountId);
  if (!account) {
    return {
      title: "Paying account not found",
      detail: "The selected account is no longer in the chart of accounts.",
      suggestion: "Pick an active cash or bank account (codes 1000-1099).",
    };
  }
  if (!isCashOrBankAccount(account)) {
    return {
      title: "Invalid paying account",
      detail: `${accountLabel(account)} is not a cash or bank account. Staff advances, receivables, prepaids, input VAT and settlement clearing accounts cannot pay an expense.`,
      suggestion: "Choose a cash or bank account in the 1000-1099 range instead.",
    };
  }
  return null;
}
