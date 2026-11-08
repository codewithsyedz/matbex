/**
 * Itemised explanation of every project transaction that is NOT part of the
 * cost vs funding reconciliation, grouped by the reason it was excluded.
 */
import { isAcquisitionDerived } from "@/lib/projectReconciliation";

export type ExclusionReason =
  | "acquisition_derived"
  | "needs_review"
  | "classified"
  | "rejected"
  | "voided"
  | "unrelated";

export interface ExcludedItem {
  id: string;
  label: string;
  date: string | null;
  amount: number;
  reason: ExclusionReason;
  reasonText: string;
}

export interface ExclusionGroup {
  reason: ExclusionReason;
  title: string;
  explanation: string;
  count: number;
  amount: number;
  items: ExcludedItem[];
}

export interface ExclusionSummary {
  groups: ExclusionGroup[];
  totalCount: number;
  totalAmount: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

const META: Record<ExclusionReason, { title: string; explanation: string }> = {
  acquisition_derived: {
    title: "Generated from the acquisition",
    explanation:
      "Posted, but already represented by the acquisition header amount. Counting them again would double the project cost.",
  },
  needs_review: {
    title: "Draft — needs review",
    explanation: "Not classified or posted, so there is no ledger entry behind them yet.",
  },
  classified: {
    title: "Classified but not posted",
    explanation: "Ready to post. They only affect reconciliation once posted to the ledger.",
  },
  rejected: {
    title: "Rejected",
    explanation: "Deliberately excluded by a reviewer — treated as not part of this project.",
  },
  voided: {
    title: "Voided / deleted",
    explanation: "Reversed after posting. The ledger impact was cancelled, so they carry no value.",
  },
  unrelated: {
    title: "Unrelated to project cost",
    explanation: "Posted but flagged as operating (non-capital) spend, so they sit outside project cost.",
  },
};

interface TxnLike {
  id: string;
  txn_date?: string | null;
  amount: number | string;
  description?: string | null;
  vendor_name?: string | null;
  category?: string | null;
  status: string;
  source?: string | null;
}

function classify(t: TxnLike): ExclusionReason | null {
  if (t.status === "posted") return isAcquisitionDerived(t) ? "acquisition_derived" : null;
  if (t.status === "voided") return "voided";
  if (t.status === "rejected") return "rejected";
  if (t.status === "needs_review") return "needs_review";
  if (t.status === "classified") return "classified";
  return "unrelated";
}

export function buildExclusionSummary(transactions: TxnLike[]): ExclusionSummary {
  const items: ExcludedItem[] = [];
  for (const t of transactions ?? []) {
    const reason = classify(t);
    if (!reason) continue;
    items.push({
      id: t.id,
      label: t.description || t.vendor_name || t.category || "Project transaction",
      date: t.txn_date ?? null,
      amount: n(t.amount),
      reason,
      reasonText: META[reason].explanation,
    });
  }

  const order: ExclusionReason[] = [
    "acquisition_derived",
    "needs_review",
    "classified",
    "rejected",
    "voided",
    "unrelated",
  ];

  const groups = order
    .map((reason) => {
      const rows = items.filter((i) => i.reason === reason);
      return {
        reason,
        title: META[reason].title,
        explanation: META[reason].explanation,
        count: rows.length,
        amount: rows.reduce((s, r) => s + r.amount, 0),
        items: rows,
      };
    })
    .filter((g) => g.count > 0);

  return {
    groups,
    totalCount: items.length,
    totalAmount: items.reduce((s, i) => s + i.amount, 0),
  };
}
