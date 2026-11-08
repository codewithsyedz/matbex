/**
 * Pre-save integrity checks for an installment finance-charge / schedule edit.
 *
 * Three independent books must agree before the revised finance charge can be
 * posted:
 *   1. The GENERAL LEDGER — DR target/asset + DR input VAT + DR finance charge
 *      must equal CR 2450 BNPL Payable, and the asset debit must equal the
 *      capitalised net price on the plan.
 *   2. The FIXED ASSET REGISTER — the linked asset's cost must equal the same
 *      net price (finance charges are expensed, never capitalised).
 *   3. The RECALCULATED SCHEDULE — paid amounts plus the re-spread remaining
 *      installments must reconcile to the revised total payable.
 */

export type IntegrityStatus = "ok" | "warn" | "error";

export interface IntegrityCheck {
  id: string;
  label: string;
  status: IntegrityStatus;
  detail: string;
}

export interface LedgerTotals {
  /** DR on the plan's target (asset / expense) account. */
  targetDebit: number;
  /** DR on 1180 Input VAT. */
  vatDebit: number;
  /** DR on 6850 Finance charges. */
  financeDebit: number;
  /** CR on 2450 BNPL Payable. */
  liabilityCredit: number;
  /** True when no ledger rows could be read (do not hard-fail on this). */
  unavailable?: boolean;
}

export interface IntegrityInput {
  cashPrice: number;
  currentFinanceCharge: number;
  currentTotalPayable: number;
  vatAmount?: number;
  paidAmount: number;
  paidCount: number;
  nextFinanceCharge: number;
  nextInstallmentCount: number;
  ledger?: LedgerTotals | null;
  assetCost?: number | null;
  assetName?: string | null;
}

export interface IntegrityResult {
  checks: IntegrityCheck[];
  /** Blocking problems — saving must be disabled. */
  hasErrors: boolean;
  /** Non-blocking discrepancies worth acknowledging. */
  hasWarnings: boolean;
  revisedTotal: number;
  scheduleRows: number[];
}

export const MONEY_TOLERANCE = 0.02;

const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmt = (n: number) => r2(n).toFixed(2);

/** Mirrors the DB schedule split: even rows, last row absorbs the rounding. */
export function recalcSchedule(outstanding: number, remainingCount: number): number[] {
  if (!(remainingCount > 0)) return [];
  const base = r2(outstanding / remainingCount);
  const last = r2(outstanding - base * (remainingCount - 1));
  return Array.from({ length: remainingCount }, (_, i) => (i === remainingCount - 1 ? last : base));
}

export function checkInstallmentIntegrity(input: IntegrityInput): IntegrityResult {
  const checks: IntegrityCheck[] = [];

  const cashPrice = r2(input.cashPrice);
  const vat = r2(input.vatAmount ?? 0);
  const currentCharge = r2(input.currentFinanceCharge);
  const currentTotal = r2(input.currentTotalPayable);
  const paidAmount = r2(input.paidAmount);
  const paidCount = Math.max(0, Math.trunc(input.paidCount));
  const nextCharge = Number(input.nextFinanceCharge);
  const nextCount = Number(input.nextInstallmentCount);

  // ---- 0. Input sanity -------------------------------------------------
  const validCharge = Number.isFinite(nextCharge) && nextCharge >= 0;
  const validCount = Number.isFinite(nextCount) && Number.isInteger(nextCount) && nextCount > 0;
  if (!validCharge || !validCount) {
    checks.push({
      id: "inputs",
      label: "Revised values",
      status: "error",
      detail: !validCharge
        ? "Finance charge must be a positive number (or zero)."
        : "Number of installments must be a whole number greater than zero.",
    });
  } else if (nextCount <= paidCount) {
    checks.push({
      id: "inputs",
      label: "Revised values",
      status: "error",
      detail: `The plan already has ${paidCount} settled installment(s) — the count must be at least ${paidCount + 1}.`,
    });
  } else {
    checks.push({
      id: "inputs",
      label: "Revised values",
      status: "ok",
      detail: `${nextCount} installment(s), finance charge ${fmt(nextCharge)}.`,
    });
  }

  const chargeAfter = validCharge ? r2(nextCharge) : currentCharge;
  const revisedTotal = r2(cashPrice + vat + chargeAfter);
  const outstanding = r2(revisedTotal - paidAmount);
  const remainingCount = validCount ? Math.max(nextCount - paidCount, 0) : 0;
  const scheduleRows = recalcSchedule(Math.max(outstanding, 0), remainingCount);

  // ---- 1. Ledger agreement --------------------------------------------
  const led = input.ledger;
  if (!led || led.unavailable) {
    checks.push({
      id: "ledger",
      label: "General ledger",
      status: "warn",
      detail: "Ledger postings could not be read — the revised total cannot be cross-checked against the journal.",
    });
  } else {
    const debits = r2(led.targetDebit + led.vatDebit + led.financeDebit);
    const credits = r2(led.liabilityCredit);
    const balanced = Math.abs(debits - credits) <= MONEY_TOLERANCE;
    const matchesPlan = Math.abs(credits - currentTotal) <= MONEY_TOLERANCE;
    const assetDebitMatches = Math.abs(r2(led.targetDebit) - cashPrice) <= MONEY_TOLERANCE;

    if (!balanced) {
      checks.push({
        id: "ledger",
        label: "General ledger",
        status: "error",
        detail: `Existing postings are out of balance — debits ${fmt(debits)} vs credits ${fmt(credits)}. Fix the journal before changing the finance charge.`,
      });
    } else if (!matchesPlan) {
      checks.push({
        id: "ledger",
        label: "General ledger",
        status: "error",
        detail: `BNPL payable credit ${fmt(credits)} does not match the plan total ${fmt(currentTotal)}.`,
      });
    } else if (!assetDebitMatches) {
      checks.push({
        id: "ledger",
        label: "General ledger",
        status: "error",
        detail: `Capitalised debit ${fmt(led.targetDebit)} does not match the plan net price ${fmt(cashPrice)} — VAT may have been applied twice.`,
      });
    } else {
      checks.push({
        id: "ledger",
        label: "General ledger",
        status: "ok",
        detail: `Balanced at ${fmt(credits)} — net ${fmt(led.targetDebit)} + VAT ${fmt(led.vatDebit)} + finance ${fmt(led.financeDebit)}. Adjustment of ${fmt(chargeAfter - currentCharge)} will be posted.`,
      });
    }
  }

  // ---- 2. Fixed asset register ----------------------------------------
  if (input.assetCost == null) {
    checks.push({
      id: "asset",
      label: "Fixed asset register",
      status: "ok",
      detail: "No fixed asset is linked to this plan — nothing to reconcile.",
    });
  } else {
    const cost = r2(input.assetCost);
    const matches = Math.abs(cost - cashPrice) <= MONEY_TOLERANCE;
    checks.push({
      id: "asset",
      label: "Fixed asset register",
      status: matches ? "ok" : "error",
      detail: matches
        ? `${input.assetName ?? "Asset"} capitalised at ${fmt(cost)}, equal to the ledger debit. Finance charge stays expensed.`
        : `${input.assetName ?? "Asset"} cost ${fmt(cost)} ≠ ledger debit ${fmt(cashPrice)}. Correct the register before repricing.`,
    });
  }

  // ---- 3. Recalculated schedule ---------------------------------------
  if (!validCount || !validCharge || remainingCount === 0) {
    checks.push({
      id: "schedule",
      label: "Recalculated schedule",
      status: "error",
      detail: "The revised schedule needs at least one unpaid installment.",
    });
  } else if (outstanding < -MONEY_TOLERANCE) {
    checks.push({
      id: "schedule",
      label: "Recalculated schedule",
      status: "error",
      detail: `Settled payments (${fmt(paidAmount)}) exceed the revised total (${fmt(revisedTotal)}). Void a payment or raise the finance charge.`,
    });
  } else {
    const sum = r2(scheduleRows.reduce((a, b) => a + b, 0));
    const reconciles = Math.abs(r2(sum + paidAmount) - revisedTotal) <= MONEY_TOLERANCE;
    checks.push({
      id: "schedule",
      label: "Recalculated schedule",
      status: reconciles ? "ok" : "error",
      detail: reconciles
        ? `${remainingCount} remaining row(s) of ${fmt(scheduleRows[0] ?? 0)} + ${fmt(paidAmount)} settled = ${fmt(revisedTotal)}.`
        : `Schedule sums to ${fmt(r2(sum + paidAmount))} but the revised total is ${fmt(revisedTotal)}.`,
    });
  }

  return {
    checks,
    hasErrors: checks.some((c) => c.status === "error"),
    hasWarnings: checks.some((c) => c.status === "warn"),
    revisedTotal,
    scheduleRows,
  };
}
