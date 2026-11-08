/**
 * Pure mirror of the SQL expense-posting rules (post_expense_to_ledger).
 *
 * Kept in TypeScript so the branch routing contract can be unit-tested and
 * reused by UI previews without hitting the database. Any change here MUST be
 * mirrored in the SQL function and vice versa.
 */

export interface CoaAccount {
  id: string;
  parent_id?: string | null;
  account_code?: string | null;
  account_name: string;
  is_active?: boolean | null;
}

/**
 * Mirrors public.resolve_branch_account(): prefer an active child account whose
 * name contains the branch name, otherwise fall back to the parent account.
 */
export function resolveBranchAccount(
  parentAccountId: string | null | undefined,
  branchName: string | null | undefined,
  accounts: CoaAccount[],
): string | null {
  if (!parentAccountId) return null;
  if (!branchName) return parentAccountId;

  const child = accounts
    .filter(
      (a) =>
        a.parent_id === parentAccountId &&
        a.is_active !== false &&
        a.account_name.toLowerCase().includes(branchName.toLowerCase()),
    )
    .sort((a, b) => (a.account_code ?? "").localeCompare(b.account_code ?? ""))[0];

  return child?.id ?? parentAccountId;
}

/** Cash on Hand when already paid, Accounts Payable when unpaid. */
export function counterAccountCode(status: "paid" | "unpaid" | null | undefined): "1000" | "2000" {
  return status === "paid" ? "1000" : "2000";
}

export interface PostingLeg {
  accountId: string;
  branchId: string | null;
  debit: number | null;
  credit: number | null;
}

export interface BuildPostingInput {
  amount: number;
  status: "paid" | "unpaid" | null | undefined;
  branchId: string | null;
  branchName: string | null;
  /** Expense or inventory account chosen on the expense (already COGS-routed). */
  debitAccountId: string;
  /** Tenant-level counter accounts keyed by code. */
  counterAccountIdByCode: Record<string, string>;
  accounts: CoaAccount[];
}

/** Builds the two legs of an expense posting, branch-resolved on both sides. */
export function buildExpensePostingLegs(input: BuildPostingInput): PostingLeg[] {
  const code = counterAccountCode(input.status);
  const counterParent = input.counterAccountIdByCode[code];
  if (!counterParent) {
    throw new Error(`Counter-account ${code} not found in chart of accounts`);
  }

  const debitAccountId = resolveBranchAccount(
    input.debitAccountId,
    input.branchName,
    input.accounts,
  )!;
  const creditAccountId = resolveBranchAccount(
    counterParent,
    input.branchName,
    input.accounts,
  )!;

  return [
    { accountId: debitAccountId, branchId: input.branchId, debit: input.amount, credit: null },
    { accountId: creditAccountId, branchId: input.branchId, debit: null, credit: input.amount },
  ];
}

/** Mirrors the DR/CR balance assertion enforced by the SQL function. */
export function isBalanced(legs: PostingLeg[], tolerance = 0.005): boolean {
  const dr = legs.reduce((s, l) => s + (l.debit ?? 0), 0);
  const cr = legs.reduce((s, l) => s + (l.credit ?? 0), 0);
  return Math.abs(dr - cr) <= tolerance;
}

/** DR/CR totals per branch — every branch must net to zero on its own. */
export function branchTotals(legs: PostingLeg[]): Record<string, { debit: number; credit: number }> {
  const out: Record<string, { debit: number; credit: number }> = {};
  for (const leg of legs) {
    const key = leg.branchId ?? "__tenant__";
    const entry = (out[key] ??= { debit: 0, credit: 0 });
    entry.debit += leg.debit ?? 0;
    entry.credit += leg.credit ?? 0;
  }
  return out;
}

/** True when every branch present in the legs balances independently. */
export function isBalancedPerBranch(legs: PostingLeg[], tolerance = 0.005): boolean {
  return Object.values(branchTotals(legs)).every(
    (t) => Math.abs(t.debit - t.credit) <= tolerance,
  );
}

export type PaymentEventKind = "payment" | "refund" | "chargeback";

export interface PaymentEvent {
  kind: PaymentEventKind;
  /** Always a positive magnitude; the kind decides the direction. */
  amount: number;
}

export interface PaymentEventInput {
  event: PaymentEvent;
  branchId: string | null;
  branchName: string | null;
  /** Expense/inventory account originally debited. */
  expenseAccountId: string;
  counterAccountIdByCode: Record<string, string>;
  accounts: CoaAccount[];
  /** Settle against Accounts Payable instead of Cash (unpaid expense). */
  againstPayable?: boolean;
}

/**
 * Builds the balanced legs for a post-recording money event.
 *
 * - payment: DR Accounts Payable / CR Cash (settling an unpaid expense), or
 *   DR expense / CR cash when paid straight away.
 * - refund (supplier returns money): DR Cash / CR expense.
 * - chargeback (bank claws the payment back): DR Accounts Payable / CR Cash is
 *   reversed, i.e. DR expense-side counter restored and CR cash removed —
 *   modelled as DR Accounts Payable reinstated / CR Cash reversed.
 */
export function buildPaymentEventLegs(input: PaymentEventInput): PostingLeg[] {
  const amount = Math.abs(input.event.amount);
  const cashParent = input.counterAccountIdByCode["1000"];
  const apParent = input.counterAccountIdByCode["2000"];
  if (!cashParent || !apParent) {
    throw new Error("Counter accounts 1000/2000 must exist in chart of accounts");
  }

  const resolve = (id: string) => resolveBranchAccount(id, input.branchName, input.accounts)!;
  const cash = resolve(cashParent);
  const ap = resolve(apParent);
  const expense = resolve(input.expenseAccountId);
  const b = input.branchId;

  switch (input.event.kind) {
    case "payment":
      return input.againstPayable
        ? [
            { accountId: ap, branchId: b, debit: amount, credit: null },
            { accountId: cash, branchId: b, debit: null, credit: amount },
          ]
        : [
            { accountId: expense, branchId: b, debit: amount, credit: null },
            { accountId: cash, branchId: b, debit: null, credit: amount },
          ];
    case "refund":
      return [
        { accountId: cash, branchId: b, debit: amount, credit: null },
        { accountId: expense, branchId: b, debit: null, credit: amount },
      ];
    case "chargeback":
      // Bank reverses a settled payment: cash comes back, the payable is restored.
      return [
        { accountId: cash, branchId: b, debit: amount, credit: null },
        { accountId: ap, branchId: b, debit: null, credit: amount },
      ];
    default:
      throw new Error(`Unknown payment event kind: ${(input.event as PaymentEvent).kind}`);
  }
}

/** Applies a sequence of events and returns all legs, in order. */
export function buildEventSequenceLegs(
  events: PaymentEvent[],
  base: Omit<PaymentEventInput, "event"> & { againstPayable?: boolean },
): PostingLeg[] {
  return events.flatMap((event) => buildPaymentEventLegs({ ...base, event }));
}

/** Remaining outstanding (unpaid) balance after a sequence of events. */
export function outstandingAfterEvents(originalAmount: number, events: PaymentEvent[]): number {
  return events.reduce((balance, e) => {
    const amt = Math.abs(e.amount);
    if (e.kind === "payment") return balance - amt;
    if (e.kind === "chargeback") return balance + amt; // payable restored
    return balance - amt; // supplier refund reduces what is still owed
  }, originalAmount);
}
