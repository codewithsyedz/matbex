/**
 * Shared net / VAT split used by the expense and acquisition forms.
 *
 * Posting shape for a purchase (input VAT is recoverable):
 *   DR expense / inventory / asset   net
 *   DR 1180 Input VAT Recoverable    vat
 *       CR AP / cash / capital        gross
 *
 * Sales work the other way round and credit output VAT (2200 VAT Payable),
 * which is why `vatAccountKind` exists — the caller says which side it is on.
 */
export type VatAccountKind = "input" | "output";

/** Chart-of-accounts codes the ledger posts VAT to. */
export const VAT_ACCOUNT_CODES: Record<VatAccountKind, string> = {
  input: "1180",
  output: "2200",
};

export const VAT_ACCOUNT_LABELS: Record<VatAccountKind, string> = {
  input: "1180 Input VAT Recoverable",
  output: "2200 VAT Payable (Output)",
};

export interface VatSplit {
  /** VAT-exclusive value that hits the expense / asset account. */
  net: number;
  /** VAT value that hits the input (or output) VAT account. */
  vat: number;
  /** Total settled with the supplier — always net + vat. */
  gross: number;
  /** Effective rate as a percentage, echoed back for display. */
  ratePercent: number;
}

export const round2 = (n: number) =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export interface VatSplitInput {
  /** The number typed into the form's amount field. */
  amount: number | string;
  /** VAT percentage, e.g. 15 for 15%. */
  ratePercent: number | string;
  /** True when `amount` already contains VAT. */
  inclusive: boolean;
  /** Skip the split entirely (zero-rated / exempt / non-recoverable). */
  vatEnabled?: boolean;
}

/**
 * Split a typed amount into net + VAT.
 * - inclusive: gross = amount, net = amount / (1 + r)
 * - exclusive: net = amount, gross = amount * (1 + r)
 * Rounding residual always lands on VAT so net + vat === gross exactly.
 */
export function splitVat(input: VatSplitInput): VatSplit {
  const amount = round2(Number(input.amount) || 0);
  const ratePercent = Number(input.ratePercent) || 0;
  const rate = ratePercent / 100;

  if (input.vatEnabled === false || rate <= 0 || amount === 0) {
    return { net: amount, vat: 0, gross: amount, ratePercent: 0 };
  }

  if (input.inclusive) {
    const net = round2(amount / (1 + rate));
    return { net, vat: round2(amount - net), gross: amount, ratePercent };
  }

  const net = amount;
  const vat = round2(amount * rate);
  return { net, vat, gross: round2(net + vat), ratePercent };
}

/** Guard mirroring the database check so the UI blocks before the RPC does. */
export function validateVatSplit(split: VatSplit): string | null {
  if (split.vat < 0) return "VAT cannot be negative";
  if (split.vat > split.gross + 0.005)
    return "VAT cannot be larger than the total amount";
  if (Math.abs(split.net + split.vat - split.gross) > 0.005)
    return "Net plus VAT must equal the total amount";
  return null;
}

// ── Consistency validation ────────────────────────────────────────────────
// The split is derived, but users can type a rate, flip inclusive/exclusive
// and (on retro fixes) edit amounts, so we re-check that the three numbers
// still agree with each other before anything is posted.

export type VatIssueSeverity = "error" | "warning";

export interface VatIssue {
  severity: VatIssueSeverity;
  /** Stable code so tests and call sites can assert without matching prose. */
  code:
    | "rate_missing"
    | "rate_out_of_range"
    | "rate_branch_mismatch"
    | "vat_negative"
    | "vat_exceeds_total"
    | "legs_do_not_balance"
    | "gross_mismatch"
    | "rate_amount_mismatch";
  message: string;
}

export interface VatConsistencyInput {
  split: VatSplit;
  /** Rate the user typed (may be blank). */
  ratePercent: number | string;
  /** Amount typed into the form. */
  enteredAmount: number | string;
  inclusive: boolean;
  /** Configured branch rate, used for a soft mismatch warning. */
  branchRatePercent?: number | null;
  /** Money tolerance in currency units. */
  tolerance?: number;
}

export interface VatConsistencyResult {
  issues: VatIssue[];
  errors: VatIssue[];
  warnings: VatIssue[];
  /** True when nothing blocks posting (warnings are allowed through). */
  valid: boolean;
}

/**
 * Full consistency check for a VAT split: rate sanity, leg arithmetic and
 * agreement between the typed amount, the rate and the resulting VAT.
 */
export function validateVatConsistency(
  input: VatConsistencyInput,
): VatConsistencyResult {
  const tol = input.tolerance ?? 0.02;
  const issues: VatIssue[] = [];
  const { split } = input;
  const rate = Number(input.ratePercent);
  const entered = round2(Number(input.enteredAmount) || 0);

  if (input.ratePercent === "" || !Number.isFinite(rate) || rate <= 0) {
    issues.push({
      severity: "error",
      code: "rate_missing",
      message:
        "Enter a VAT rate greater than 0, or turn the VAT split off for a zero-rated purchase.",
    });
  } else if (rate > 100) {
    issues.push({
      severity: "error",
      code: "rate_out_of_range",
      message: `VAT rate ${rate}% is out of range — it must be between 0% and 100%.`,
    });
  } else if (
    input.branchRatePercent != null &&
    input.branchRatePercent > 0 &&
    Math.abs(rate - input.branchRatePercent) > 0.001
  ) {
    issues.push({
      severity: "warning",
      code: "rate_branch_mismatch",
      message: `Rate ${rate}% differs from this branch's configured VAT rate of ${input.branchRatePercent}%.`,
    });
  }

  const legIssue = validateVatSplit(split);
  if (legIssue) {
    const code =
      split.vat < 0
        ? "vat_negative"
        : split.vat > split.gross + 0.005
          ? "vat_exceeds_total"
          : "legs_do_not_balance";
    issues.push({
      severity: "error",
      code,
      message: `${legIssue} — net ${split.net.toFixed(2)} + VAT ${split.vat.toFixed(
        2,
      )} must equal the total ${split.gross.toFixed(2)}.`,
    });
  }

  // The typed amount must still be represented in the split: it is the gross
  // when VAT inclusive and the net when VAT exclusive.
  const expectedSide = input.inclusive ? split.gross : split.net;
  if (entered > 0 && Math.abs(expectedSide - entered) > tol) {
    issues.push({
      severity: "error",
      code: "gross_mismatch",
      message: `VAT split totals ${expectedSide.toFixed(2)} but the expense amount is ${entered.toFixed(
        2,
      )} (difference ${(expectedSide - entered).toFixed(2)}).`,
    });
  }

  // The VAT value must be what the rate produces for the net.
  if (Number.isFinite(rate) && rate > 0 && rate <= 100 && split.gross !== 0) {
    const expectedVat = round2(split.net * (rate / 100));
    if (Math.abs(expectedVat - split.vat) > tol) {
      issues.push({
        severity: "error",
        code: "rate_amount_mismatch",
        message: `VAT of ${split.vat.toFixed(2)} does not match ${rate}% of the net ${split.net.toFixed(
          2,
        )} (expected ${expectedVat.toFixed(2)}).`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { issues, errors, warnings, valid: errors.length === 0 };
}
