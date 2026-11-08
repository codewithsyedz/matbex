/**
 * Line-level explanation of how Project Cost and Project Funding were computed.
 *
 * Mirrors the rules in projectReconciliation.ts exactly:
 * - A posted acquisition contributes its header amount once (never allocation lines).
 * - Acquisition-derived project transactions are excluded.
 * - Funding = partner capital + loans + payables + company-paid posted costs +
 *   outstanding vendor payables.
 */
import { isAcquisitionDerived, isCountableAdjustment, type ReconAdjustment } from "@/lib/projectReconciliation";

export interface BreakdownLeg {
  key: string;
  label: string;
  detail?: string;
  date?: string | null;
  amount: number;
  /** true when the leg is shown for context only and is NOT added to the total */
  informational?: boolean;
}

export interface ReconciliationBreakdown {
  costLegs: BreakdownLeg[];
  costTotal: number;
  fundingLegs: BreakdownLeg[];
  fundingTotal: number;
  excludedLegs: BreakdownLeg[];
  unpostedLegs: BreakdownLeg[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;

interface TxnLike {
  id: string;
  txn_date?: string | null;
  amount: number | string;
  description?: string | null;
  vendor_name?: string | null;
  category?: string | null;
  status: string;
  source?: string | null;
  paid_by?: string | null;
  is_paid?: boolean;
}

interface AcqLike {
  id: string;
  amount: number | string;
  seller_name?: string | null;
  acquisition_date?: string | null;
  classification_status: string;
}

interface FunderLike {
  id: string;
  paid_by: string;
  partner_id: string | null;
  funding_classification?: string | null;
  amount: number | string;
}

interface FundingRow {
  partner_id?: string;
  partner_name?: string;
  capital_balance: number | string;
  loan_balance: number | string;
  payable_balance: number | string;
}

interface AdjustmentLike extends ReconAdjustment {
  id: string;
  label?: string;
  date?: string | null;
  account_code?: string | null;
}

export function buildReconciliationBreakdown(input: {
  transactions: TxnLike[];
  acquisition: AcqLike | null | undefined;
  acquisitionFunders: FunderLike[];
  funding: FundingRow[];
  partnerNames?: Record<string, string>;
  adjustments?: AdjustmentLike[];
}): ReconciliationBreakdown {
  const txns = input.transactions ?? [];
  const posted = txns.filter((t) => t.status === "posted" && !isAcquisitionDerived(t));
  const acq = input.acquisition;
  const acqPosted = !!acq && acq.classification_status === "posted";

  const costLegs: BreakdownLeg[] = [];
  if (acqPosted && acq) {
    costLegs.push({
      key: `acq-${acq.id}`,
      label: `Business acquisition — ${acq.seller_name ?? "seller"}`,
      detail: "Posted acquisition header (allocation lines excluded to avoid double counting)",
      date: acq.acquisition_date ?? null,
      amount: n(acq.amount),
    });
  }
  for (const t of posted) {
    costLegs.push({
      key: `txn-${t.id}`,
      label: t.description || t.vendor_name || "Project cost",
      detail: [t.category, t.paid_by === "partner" ? "paid by partner" : "paid by company", t.is_paid ? "paid" : "unpaid"]
        .filter(Boolean)
        .join(" · "),
      date: t.txn_date ?? null,
      amount: n(t.amount),
    });
  }
  const countableAdjustments = (input.adjustments ?? []).filter(isCountableAdjustment) as AdjustmentLike[];
  for (const a of countableAdjustments.filter((x) => x.side === "cost")) {
    costLegs.push({
      key: `adj-${a.id}`,
      label: a.label || "Approved journal adjustment",
      detail: `Approved journal adjustment${a.account_code ? ` · account ${a.account_code}` : ""}`,
      date: a.date ?? null,
      amount: n(a.amount),
    });
  }
  const costTotal = costLegs.reduce((s, l) => s + l.amount, 0);

  const fundingLegs: BreakdownLeg[] = [];
  for (const f of input.funding ?? []) {
    const name = f.partner_name ?? "Partner";
    if (n(f.capital_balance)) {
      fundingLegs.push({
        key: `cap-${f.partner_id ?? name}`,
        label: `${name} — partner capital`,
        detail: "Net credits on the partner capital account",
        amount: n(f.capital_balance),
      });
    }
    if (n(f.loan_balance)) {
      fundingLegs.push({
        key: `loan-${f.partner_id ?? name}`,
        label: `${name} — partner loan`,
        amount: n(f.loan_balance),
      });
    }
    if (n(f.payable_balance)) {
      fundingLegs.push({
        key: `pay-${f.partner_id ?? name}`,
        label: `${name} — due to partner`,
        amount: n(f.payable_balance),
      });
    }
  }
  const companyPaid = posted.filter((t) => t.paid_by === "company" && t.is_paid);
  const companyFunded = companyPaid.reduce((s, t) => s + n(t.amount), 0);
  if (companyFunded) {
    fundingLegs.push({
      key: "company-funded",
      label: "Company funding (cash/bank)",
      detail: `${companyPaid.length} posted cost${companyPaid.length === 1 ? "" : "s"} paid by the company`,
      amount: companyFunded,
    });
  }
  const unpaidCompany = posted.filter((t) => t.paid_by === "company" && !t.is_paid);
  const outstandingVendor = unpaidCompany.reduce((s, t) => s + n(t.amount), 0);
  if (outstandingVendor) {
    fundingLegs.push({
      key: "vendor-payables",
      label: "Outstanding vendor payables",
      detail: `${unpaidCompany.length} posted cost${unpaidCompany.length === 1 ? "" : "s"} not yet paid`,
      amount: outstandingVendor,
    });
  }
  for (const a of countableAdjustments.filter((x) => x.side === "funding")) {
    fundingLegs.push({
      key: `adjf-${a.id}`,
      label: a.label || "Approved funding adjustment",
      detail: `Approved journal adjustment${a.account_code ? ` · account ${a.account_code}` : ""}`,
      date: a.date ?? null,
      amount: n(a.amount),
    });
  }
  const fundingTotal = fundingLegs.filter((l) => !l.informational).reduce((s, l) => s + l.amount, 0);

  // Context: who funded the acquisition. Already reflected inside partner
  // capital / loan / payable balances, so shown as informational only.
  if (acqPosted) {
    for (const f of input.acquisitionFunders ?? []) {
      const name =
        f.paid_by === "company"
          ? "Company"
          : (f.partner_id && input.partnerNames?.[f.partner_id]) || "Partner";
      fundingLegs.push({
        key: `funder-${f.id}`,
        label: `${name} — acquisition funding leg`,
        detail: `${f.funding_classification ?? "capital"} · already included in the balances above`,
        amount: n(f.amount),
        informational: true,
      });
    }
  }

  const excludedLegs = txns
    .filter((t) => t.status === "posted" && isAcquisitionDerived(t))
    .map((t) => ({
      key: `ex-${t.id}`,
      label: t.description || "Acquisition-derived cost",
      detail: "Excluded — already counted in the acquisition header",
      date: t.txn_date ?? null,
      amount: n(t.amount),
      informational: true,
    }));

  const unpostedLegs = txns
    .filter((t) => t.status !== "posted" && t.status !== "voided" && t.status !== "rejected")
    .map((t) => ({
      key: `un-${t.id}`,
      label: t.description || t.vendor_name || "Unposted cost",
      detail: `Status: ${t.status.replace("_", " ")} — not in the ledger yet`,
      date: t.txn_date ?? null,
      amount: n(t.amount),
      informational: true,
    }));

  return { costLegs, costTotal, fundingLegs, fundingTotal, excludedLegs, unpostedLegs };
}
