/**
 * Pure reconciliation logic for BNPL / installment payments.
 * Kept free of the API so it can be unit-tested directly.
 */

export type MatchStatus =
  | "matched"
  | "missing_gl"
  | "amount_mismatch"
  | "account_mismatch"
  | "unbalanced"
  | "voided"
  | "overdue"
  | "upcoming";

export interface ReconLine {
  account_id: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  is_voided: boolean;
  transaction_date: string;
  description: string | null;
}

export interface ReconAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

export interface ReconCheck {
  /** Short label of what was compared. */
  label: string;
  /** Human-readable expected value. */
  expected: string;
  /** Human-readable actual value. */
  actual: string;
  status: "pass" | "fail" | "skipped";
  /** Why this check passed, failed or could not be run. */
  detail: string;
}

export interface ReconExplanation {
  /** Where the expected credit account came from. */
  expectedSource:
    | "partner_equity"
    | "partner_equity_unlinked"
    | "partner_no_capital_account"
    | "payment_account"
    | "none";
  expectedAccountLabel: string;
  actualAccountLabel: string;
  /** Raw id stored on the payment row before resolution (partner funding only). */
  capitalAccountId: string | null;
  /** Chart-of-accounts id the ledger credit was compared against. */
  expectedAccountId: string | null;
  actualAccountId: string | null;
  checks: ReconCheck[];
  /** One-line verdict shown at the top of the details panel. */
  summary: string;
  /** Result of the defensive "is this really a chart-of-accounts id" guard. */
  mappingGuard: MappingGuardResult;
}

export interface InstallmentReconRow {
  payment_id: string;
  plan_id: string;
  plan_description: string;
  provider: string;
  supplier_name: string | null;
  branch_id: string | null;
  installment_no: number;
  installment_count: number;
  due_date: string;
  paid_date: string | null;
  amount: number;
  paid_amount: number;
  status: string;
  funding_source: string;
  reference_number: string | null;
  batch_id: string | null;
  expected_credit_account_id: string | null;
  actual_credit_account_id: string | null;
  liabilityDebit: number;
  cashCredit: number;
  glDebit: number;
  glCredit: number;
  difference: number;
  daysOverdue: number;
  lines: ReconLine[];
  matchStatus: MatchStatus;
  issues: string[];
  explanation: ReconExplanation;
}

export type MappingGuardReason =
  | "ok"
  | "not_resolved"
  | "partner_record_id"
  | "not_in_chart_of_accounts";

export interface MappingGuardResult {
  /** true when the resolved id is safe to compare against ledger account ids. */
  safe: boolean;
  reason: MappingGuardReason;
  message: string;
}

/**
 * Defensive mapping check.
 *
 * Guards against the class of bug where an `owner_capital_accounts.id`
 * (a partner record id) leaks into the comparison against
 * `account_transactions.account_id` (a chart-of-accounts id), producing false
 * "Account mismatch" verdicts. Any expected id that is a known partner capital
 * record id — or that simply does not exist in the loaded chart of accounts —
 * is rejected and the account comparison is skipped instead of failing.
 */
export function checkExpectedAccountMapping(
  expected: string | null,
  accById: Map<string, ReconAccount>,
  capitalRecordIds?: Set<string>,
): MappingGuardResult {
  if (!expected) {
    return {
      safe: false,
      reason: "not_resolved",
      message: "No expected credit account could be resolved, so no account comparison was run.",
    };
  }
  if (capitalRecordIds?.has(expected)) {
    return {
      safe: false,
      reason: "partner_record_id",
      message:
        "The resolved id is a partner capital record id, not a chart-of-accounts id. The comparison was blocked to avoid a false mismatch — link an equity account to this partner capital account.",
    };
  }
  if (accById.size > 0 && !accById.has(expected)) {
    return {
      safe: false,
      reason: "not_in_chart_of_accounts",
      message:
        "The resolved id was not found in the chart of accounts, so it cannot be compared against ledger account ids.",
    };
  }
  return {
    safe: true,
    reason: "ok",
    message: "The resolved id is a valid chart-of-accounts id and is safe to compare.",
  };
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Resolve which chart-of-accounts row the ledger credit is expected to hit.
 *
 * Partner-funded payments store `capital_account_id`, which is the id of the
 * `owner_capital_accounts` record — NOT a chart-of-accounts id. It must be
 * translated to that partner's `equity_account_id` before comparing against the
 * ledger, otherwise every partner-funded payment shows a false mismatch.
 */
export function resolveExpectedCreditAccountId(
  payment: { funding_source?: string | null; capital_account_id?: string | null; payment_account_id?: string | null },
  equityByCapitalId: Map<string, string | null>,
): string | null {
  if (payment.funding_source === "partner") {
    if (!payment.capital_account_id) return null;
    return equityByCapitalId.get(payment.capital_account_id) ?? null;
  }
  return payment.payment_account_id ?? null;
}

const accountLabel = (id: string | null, accById: Map<string, ReconAccount>) => {
  if (!id) return "—";
  const a = accById.get(id);
  return a ? `${a.account_code} · ${a.account_name}` : `Unknown account (${id})`;
};

export interface BuildRowsArgs {
  payments: any[];
  planById: Map<string, any>;
  txnsByBatch: Map<string, any[]>;
  accById: Map<string, ReconAccount>;
  equityByCapitalId: Map<string, string | null>;
  /** Ids of `owner_capital_accounts` rows — never valid ledger account ids. */
  capitalRecordIds?: Set<string>;
  /** YYYY-MM-DD; defaults to today (UTC). */
  today?: string;
}

export function buildInstallmentReconRows({
  payments,
  planById,
  txnsByBatch,
  accById,
  equityByCapitalId,
  capitalRecordIds,
  today,
}: BuildRowsArgs): InstallmentReconRow[] {
  const todayStr = today ?? new Date().toISOString().slice(0, 10);

  return payments.map((p) => {
    const plan = planById.get(p.plan_id);
    const raw = p.batch_id ? txnsByBatch.get(p.batch_id) ?? [] : [];
    const lines: ReconLine[] = raw.map((t) => {
      const a = accById.get(t.account_id);
      return {
        account_id: t.account_id,
        code: a?.account_code ?? "?",
        name: a?.account_name ?? "Unknown account",
        type: a?.account_type ?? "",
        debit: Number(t.debit || 0),
        credit: Number(t.credit || 0),
        is_voided: !!t.is_voided,
        transaction_date: t.transaction_date,
        description: t.description ?? null,
      };
    });
    const active = lines.filter((l) => !l.is_voided);
    const glDebit = round2(active.reduce((s, l) => s + l.debit, 0));
    const glCredit = round2(active.reduce((s, l) => s + l.credit, 0));
    const liabilityDebit = round2(
      active.filter((l) => l.type === "liability").reduce((s, l) => s + l.debit, 0),
    );
    const creditLines = active.filter((l) => l.credit > 0);
    const cashCredit = round2(creditLines.reduce((s, l) => s + l.credit, 0));
    const resolvedExpected = resolveExpectedCreditAccountId(p, equityByCapitalId);
    const mappingGuard = checkExpectedAccountMapping(resolvedExpected, accById, capitalRecordIds);
    // Only compare ids the guard vouched for.
    const expected = mappingGuard.safe ? resolvedExpected : null;
    const actual = creditLines[0]?.account_id ?? null;

    const paid = p.status === "paid";
    const difference = round2((paid ? Number(p.paid_amount || 0) : 0) - cashCredit);
    const daysOverdue =
      !paid && p.due_date < todayStr
        ? Math.floor((Date.parse(todayStr) - Date.parse(p.due_date)) / 86400000)
        : 0;

    const issues: string[] = [];
    let matchStatus: MatchStatus;

    if (p.voided_at) {
      matchStatus = "voided";
      issues.push("Payment was voided and reversed.");
    } else if (!paid) {
      matchStatus = daysOverdue > 0 ? "overdue" : "upcoming";
      if (daysOverdue > 0) issues.push(`Missing payment - ${daysOverdue} day(s) past due.`);
    } else if (!p.batch_id || active.length === 0) {
      matchStatus = "missing_gl";
      issues.push("Marked paid but no bank/cash movement is posted in the ledger.");
    } else if (Math.abs(glDebit - glCredit) > 0.005) {
      matchStatus = "unbalanced";
      issues.push(`Ledger batch is unbalanced (DR ${glDebit} vs CR ${glCredit}).`);
    } else if (Math.abs(difference) > 0.005) {
      matchStatus = "amount_mismatch";
      issues.push(
        `Received ${round2(Number(p.paid_amount || 0))} but bank/cash movement is ${cashCredit}.`,
      );
    } else if (expected && actual && expected !== actual) {
      matchStatus = "account_mismatch";
      const e = accById.get(expected);
      const a = accById.get(actual);
      issues.push(
        `Funded from ${e ? `${e.account_code} ${e.account_name}` : "selected account"} but ledger credited ${
          a ? `${a.account_code} ${a.account_name}` : "another account"
        }.`,
      );
    } else {
      matchStatus = "matched";
    }

    if (paid && resolvedExpected && !mappingGuard.safe && mappingGuard.reason !== "not_resolved") {
      issues.push(mappingGuard.message);
    }

    if (paid && liabilityDebit === 0 && active.length > 0 && matchStatus === "matched") {
      matchStatus = "account_mismatch";
      issues.push("No liability (BNPL payable) debit found for this settlement.");
    }

    const explanation = buildExplanation({
      payment: p,
      expected,
      resolvedExpected,
      mappingGuard,
      actual,
      accById,
      equityByCapitalId,
      matchStatus,
      paid,
      cashCredit,
      glDebit,
      glCredit,
      liabilityDebit,
      difference,
      activeLineCount: active.length,
      daysOverdue,
    });

    return {
      payment_id: p.id,
      plan_id: p.plan_id,
      plan_description: plan?.description ?? "Installment plan",
      provider: plan?.provider ?? "other",
      supplier_name: plan?.supplier_name ?? null,
      branch_id: p.branch_id ?? null,
      installment_no: p.installment_no,
      installment_count: plan?.installment_count ?? 0,
      due_date: p.due_date,
      paid_date: p.paid_date ?? null,
      amount: Number(p.amount || 0),
      paid_amount: Number(p.paid_amount || 0),
      status: p.status,
      funding_source: p.funding_source,
      reference_number: p.reference_number ?? null,
      batch_id: p.batch_id ?? null,
      expected_credit_account_id: expected ?? null,
      actual_credit_account_id: actual,
      liabilityDebit,
      cashCredit,
      glDebit,
      glCredit,
      difference,
      daysOverdue,
      lines,
      matchStatus,
      issues,
      explanation,
    };
  });
}

interface ExplainArgs {
  payment: any;
  expected: string | null;
  resolvedExpected?: string | null;
  mappingGuard?: MappingGuardResult;
  actual: string | null;
  accById: Map<string, ReconAccount>;
  equityByCapitalId: Map<string, string | null>;
  matchStatus: MatchStatus;
  paid: boolean;
  cashCredit: number;
  glDebit: number;
  glCredit: number;
  liabilityDebit: number;
  difference: number;
  activeLineCount: number;
  daysOverdue: number;
}

/**
 * Builds the human-readable "why did this match / not match" breakdown that the
 * reconciliation screen renders under each row.
 */
export function buildExplanation({
  payment: p,
  expected,
  resolvedExpected,
  mappingGuard,
  actual,
  accById,
  equityByCapitalId,
  matchStatus,
  paid,
  cashCredit,
  glDebit,
  glCredit,
  liabilityDebit,
  difference,
  activeLineCount,
  daysOverdue,
}: ExplainArgs): ReconExplanation {
  const guard: MappingGuardResult =
    mappingGuard ?? checkExpectedAccountMapping(expected, accById);
  const isPartner = p.funding_source === "partner";
  let expectedSource: ReconExplanation["expectedSource"];
  if (isPartner) {
    if (!p.capital_account_id) expectedSource = "partner_no_capital_account";
    else if (!equityByCapitalId.get(p.capital_account_id)) expectedSource = "partner_equity_unlinked";
    else expectedSource = "partner_equity";
  } else {
    expectedSource = p.payment_account_id ? "payment_account" : "none";
  }

  const expectedLabel = accountLabel(expected, accById);
  const actualLabel = accountLabel(actual, accById);
  const checks: ReconCheck[] = [];

  // 1. Resolution of the expected credit account
  checks.push({
    label: "Expected credit account resolved",
    expected: isPartner
      ? `partner capital record ${p.capital_account_id ?? "—"} → equity ${expected ?? "unresolved"}`
      : `payment account ${expected ?? "—"}`,
    actual: expectedLabel,
    status: expected ? "pass" : "skipped",
    detail: {
      partner_equity:
        "Partner-funded: the stored capital_account_id points at the partner record, so it was translated to that partner's equity account in the chart of accounts before comparing.",
      partner_equity_unlinked:
        "Partner-funded, but this partner capital account has no equity account linked in the chart of accounts, so no account comparison was possible.",
      partner_no_capital_account:
        "Partner-funded, but no partner capital account was stored on the payment, so no account comparison was possible.",
      payment_account: "Company-funded: the bank/cash account selected on the payment is the expected credit account.",
      none: "No payment account was stored on this payment, so no account comparison was possible.",
    }[expectedSource],
  });

  // 2. Ledger posting present
  checks.push({
    label: "Ledger movement posted",
    expected: paid ? "a posted, non-voided journal batch" : "not required (not yet paid)",
    actual: p.batch_id ? `batch ${p.batch_id} · ${activeLineCount} active line(s)` : "no batch",
    status: !paid ? "skipped" : p.batch_id && activeLineCount > 0 ? "pass" : "fail",
    detail: !paid
      ? daysOverdue > 0
        ? `Installment is unpaid and ${daysOverdue} day(s) past due, so no ledger entry is expected yet.`
        : "Installment is not due/paid yet, so no ledger entry is expected."
      : p.batch_id && activeLineCount > 0
        ? "A posted journal batch was found and its non-voided lines were used for the comparison."
        : "The installment is marked paid but no active ledger lines exist for it.",
  });

  // 3. Batch balanced
  checks.push({
    label: "Batch balanced (DR = CR)",
    expected: `debits ${glDebit}`,
    actual: `credits ${glCredit}`,
    status: !paid || activeLineCount === 0 ? "skipped" : Math.abs(glDebit - glCredit) <= 0.005 ? "pass" : "fail",
    detail:
      Math.abs(glDebit - glCredit) <= 0.005
        ? "Total debits equal total credits in the batch."
        : `The batch is out of balance by ${round2(glDebit - glCredit)}.`,
  });

  // 4. Amount
  checks.push({
    label: "Amount received vs ledger movement",
    expected: String(round2(Number(p.paid_amount || 0))),
    actual: String(cashCredit),
    status: !paid || activeLineCount === 0 ? "skipped" : Math.abs(difference) <= 0.005 ? "pass" : "fail",
    detail:
      Math.abs(difference) <= 0.005
        ? "The credited bank/cash/equity movement equals the amount recorded as received."
        : `Difference of ${difference} between the recorded receipt and the ledger credit.`,
  });

  // 5. Account identity
  const accountComparable = !!expected && !!actual;
  checks.push({
    label: "Expected ID is a chart-of-accounts ID",
    expected: "an id present in chart_of_accounts",
    actual: resolvedExpected ? `${resolvedExpected} — ${guard.reason}` : "nothing resolved",
    status: !resolvedExpected ? "skipped" : guard.safe ? "pass" : "fail",
    detail: guard.message,
  });
  checks.push({
    label: "Credited account ID matches expected account ID",
    expected: expected ? `${expected} (${expectedLabel})` : "not resolvable",
    actual: actual ? `${actual} (${actualLabel})` : "no credit line",
    status: !accountComparable ? "skipped" : expected === actual ? "pass" : "fail",
    detail: !accountComparable
      ? "One side of the comparison is missing, so the account check was skipped and cannot flag a mismatch."
      : expected === actual
        ? "The chart-of-accounts ID credited in the ledger is exactly the one the payment was funded from."
        : "The ledger credited a different chart-of-accounts ID than the funding account recorded on the payment.",
  });

  // 6. Liability relief
  checks.push({
    label: "BNPL liability debited",
    expected: "a debit to the liability (BNPL payable) account",
    actual: `liability debit ${liabilityDebit}`,
    status: !paid || activeLineCount === 0 ? "skipped" : liabilityDebit > 0 ? "pass" : "fail",
    detail:
      liabilityDebit > 0
        ? "The settlement reduces the BNPL payable balance as expected."
        : "No liability debit was found, so the payable balance was not relieved by this entry.",
  });

  const summary =
    matchStatus === "matched"
      ? `Matched — the ledger credited ${expectedLabel} for ${cashCredit}, exactly as funded.`
      : matchStatus === "account_mismatch"
        ? accountComparable && expected !== actual
          ? `Not matched — funded from ${expectedLabel} but the ledger credited ${actualLabel}.`
          : "Not matched — the settlement did not relieve the BNPL liability account."
        : matchStatus === "amount_mismatch"
          ? `Not matched — amounts differ by ${difference}.`
          : matchStatus === "unbalanced"
            ? `Not matched — the journal batch is unbalanced (DR ${glDebit} vs CR ${glCredit}).`
            : matchStatus === "missing_gl"
              ? "Not matched — marked paid but nothing is posted in the ledger."
              : matchStatus === "voided"
                ? "Voided — the payment and its ledger entry were reversed."
                : matchStatus === "overdue"
                  ? `Not paid — ${daysOverdue} day(s) past due, so no ledger comparison was run.`
                  : "Upcoming — not due yet, so no ledger comparison was run.";

  return {
    expectedSource,
    expectedAccountLabel: expectedLabel,
    actualAccountLabel: actualLabel,
    capitalAccountId: p.capital_account_id ?? null,
    mappingGuard: guard,
    expectedAccountId: expected ?? null,
    actualAccountId: actual ?? null,
    checks,
    summary,
  };
}

export function computeReconTotals(rows: InstallmentReconRow[]) {
  const t = rows.reduce(
    (acc, r) => {
      acc.scheduled += r.amount;
      if (r.status === "paid") acc.received += r.paid_amount;
      acc.movements += r.cashCredit;
      if (r.matchStatus === "overdue") acc.overdue += r.amount;
      if (["missing_gl", "amount_mismatch", "unbalanced", "account_mismatch"].includes(r.matchStatus))
        acc.mismatched += 1;
      return acc;
    },
    { scheduled: 0, received: 0, movements: 0, overdue: 0, mismatched: 0 },
  );
  return {
    scheduled: round2(t.scheduled),
    received: round2(t.received),
    movements: round2(t.movements),
    overdue: round2(t.overdue),
    mismatched: t.mismatched,
    unmatchedDelta: round2(t.received - t.movements),
  };
}
