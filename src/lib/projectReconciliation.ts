/**
 * Project cost vs funding reconciliation.
 *
 * Rules (see accounting spec):
 * - Only POSTED items count as project cost or project funding.
 * - A posted acquisition is counted ONCE, via its header amount. Its allocation
 *   lines describe what the price represents and must never be added on top.
 * - Project transactions generated from the acquisition (source "acquisition")
 *   are excluded so the same money is not counted twice.
 * - Partner funding is taken from the funding summary and counted once.
 * - Approved & posted journal adjustments tagged to the project are included
 *   automatically (cost side or funding side depending on the accounts hit).
 *   They never mutate the acquisition, which stays read-only once posted.
 */

export interface ReconTxn {
  amount: number | string;
  status: string;
  source?: string | null;
  treatment?: string | null;
  paid_by?: "company" | "partner" | string;
  is_paid?: boolean;
  partner_id?: string | null;
}

export interface ReconAcquisition {
  amount: number | string;
  classification_status: "pending" | "classified" | "posted" | string;
}

export interface ReconFundingRow {
  capital_balance: number | string;
  loan_balance: number | string;
  payable_balance: number | string;
}

/** A journal adjustment tagged to the project. */
export interface ReconAdjustment {
  id?: string;
  /** signed amount: positive increases the side, negative reduces it */
  amount: number | string;
  side: "cost" | "funding";
  approval_status?: string | null;
  is_posted?: boolean;
  is_voided?: boolean;
  /** true when the adjustment belongs to the acquisition posting itself */
  acquisition_derived?: boolean;
}

export function isCountableAdjustment(a: ReconAdjustment): boolean {
  return (
    (a.approval_status ?? "approved") === "approved" &&
    a.is_posted !== false &&
    !a.is_voided &&
    !a.acquisition_derived
  );
}

export interface ProjectReconciliation {
  costTotal: number;
  fundingTotal: number;
  variance: number;
  balanced: boolean;
  status: "RECONCILED" | "NOT_RECONCILED";
  partnerCapital: number;
  partnerLoans: number;
  partnerPayables: number;
  companyFunded: number;
  outstandingVendor: number;
  acquisitionCost: number;
  projectSpend: number;
  costAdjustments: number;
  fundingAdjustments: number;
  adjustmentCount: number;
  unpostedCount: number;
  unclassifiedCount: number;
  excludedCount: number;
  /** difference kept for backwards compatibility with existing UI */
  difference: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

/** A project transaction that duplicates the acquisition header. */
export function isAcquisitionDerived(t: ReconTxn): boolean {
  return (t.source ?? "") === "acquisition";
}

export function computeProjectReconciliation(input: {
  transactions: ReconTxn[];
  acquisition: ReconAcquisition | null | undefined;
  funding: ReconFundingRow[];
  adjustments?: ReconAdjustment[];
}): ProjectReconciliation {
  const txns = input.transactions ?? [];
  const posted = txns.filter((t) => t.status === "posted" && !isAcquisitionDerived(t));
  const excludedCount = txns.filter((t) => t.status === "posted" && isAcquisitionDerived(t)).length;

  const acq = input.acquisition;
  // Draft / classified acquisitions are NOT project cost yet.
  const acquisitionCost = acq && acq.classification_status === "posted" ? n(acq.amount) : 0;

  const projectSpend = posted.reduce((s, t) => s + n(t.amount), 0);

  const countableAdjustments = (input.adjustments ?? []).filter(isCountableAdjustment);
  const costAdjustments = countableAdjustments
    .filter((a) => a.side === "cost")
    .reduce((s, a) => s + n(a.amount), 0);
  const fundingAdjustments = countableAdjustments
    .filter((a) => a.side === "funding")
    .reduce((s, a) => s + n(a.amount), 0);

  const costTotal = projectSpend + acquisitionCost + costAdjustments;

  const outstandingVendor = posted
    .filter((t) => !t.is_paid && t.paid_by === "company")
    .reduce((s, t) => s + n(t.amount), 0);
  const companyFunded = posted
    .filter((t) => t.paid_by === "company" && t.is_paid)
    .reduce((s, t) => s + n(t.amount), 0);

  const funding = input.funding ?? [];
  const partnerCapital = funding.reduce((s, f) => s + n(f.capital_balance), 0);
  const partnerLoans = funding.reduce((s, f) => s + n(f.loan_balance), 0);
  const partnerPayables = funding.reduce((s, f) => s + n(f.payable_balance), 0);

  const fundingTotal =
    partnerCapital +
    partnerLoans +
    partnerPayables +
    companyFunded +
    outstandingVendor +
    fundingAdjustments;

  const variance = Number((costTotal - fundingTotal).toFixed(2));
  const balanced = Math.abs(variance) <= 0.01;

  return {
    costTotal,
    fundingTotal,
    variance,
    difference: variance,
    balanced,
    status: balanced ? "RECONCILED" : "NOT_RECONCILED",
    partnerCapital,
    partnerLoans,
    partnerPayables,
    companyFunded,
    outstandingVendor,
    acquisitionCost,
    projectSpend,
    costAdjustments,
    fundingAdjustments,
    adjustmentCount: countableAdjustments.length,
    unpostedCount: txns.filter((t) => t.status !== "posted" && t.status !== "voided" && t.status !== "rejected").length,
    unclassifiedCount: txns.filter((t) => t.status === "needs_review").length,
    excludedCount,
  };
}
