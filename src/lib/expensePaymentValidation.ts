/**
 * Guardrails for the "paid vs unpaid" × "payment method" combination.
 *
 * A supplier bill marked **paid** must be settled with a real cash/bank
 * outflow, because the ledger immediately credits Cash/Bank. Choosing a
 * credit-style payment method (on account, supplier credit, pay later…)
 * while the status says paid means no Accounts Payable is ever created —
 * the liability silently disappears from the books.
 */

export type PaymentStatusLike = "paid" | "unpaid" | "partial" | string;

export interface PaymentMethodWarning {
  level: "error" | "warning";
  title: string;
  message: string;
  suggestion: string;
}

/** Payment methods that mean "not settled yet" → they belong to Accounts Payable. */
const CREDIT_METHODS = new Set([
  "credit",
  "on_account",
  "on-account",
  "account",
  "supplier_credit",
  "ap",
  "accounts_payable",
  "pay_later",
  "paylater",
  "deferred",
  "due",
]);

/** Methods that settle only once the instrument clears. Advisory, not blocking. */
const CLEARING_METHODS = new Set(["cheque", "check", "post_dated_cheque"]);

const normalize = (m?: string | null) => (m ?? "").trim().toLowerCase().replace(/\s+/g, "_");

export function isCreditPaymentMethod(method?: string | null): boolean {
  return CREDIT_METHODS.has(normalize(method));
}

export function isClearingPaymentMethod(method?: string | null): boolean {
  return CLEARING_METHODS.has(normalize(method));
}

/**
 * Returns a warning when the selected status and payment method disagree.
 * `error` level should block saving; `warning` level is advisory only.
 */
export function getPaymentMethodStatusWarning(
  status: PaymentStatusLike,
  method?: string | null,
): PaymentMethodWarning | null {
  const isPaid = status === "paid";

  if (isPaid && isCreditPaymentMethod(method)) {
    return {
      level: "error",
      title: "Credit purchase cannot be marked Paid",
      message:
        "This payment method means the supplier has not been paid yet, but the status says Paid — the ledger would credit Cash/Bank and no Accounts Payable would ever be created.",
      suggestion:
        "Set the status to Unpaid (DR Expense/Inventory · CR 2000 Accounts Payable), then mark it paid later to post the settlement entry (DR AP · CR Cash/Bank).",
    };
  }

  if (isPaid && isClearingPaymentMethod(method)) {
    return {
      level: "warning",
      title: "Cheque marked as Paid",
      message:
        "A cheque only settles the supplier once it clears. Marking it Paid credits Cash/Bank straight away, so the payable disappears before the money actually leaves the account.",
      suggestion:
        "If the cheque has not cleared yet, keep the bill Unpaid so it stays in Accounts Payable, then mark it paid on the clearing date.",
    };
  }

  return null;
}
