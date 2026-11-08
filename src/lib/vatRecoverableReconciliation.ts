/**
 * Pure aggregation helpers for the "VAT recoverable reconciliation" panel.
 *
 * Ledger side  : debit − credit on Input VAT Recoverable accounts (1180-1182,
 *                or any account named "Input VAT" / "VAT recoverable").
 * Source side  : vat_amount on expenses + tax_amount on purchase invoices +
 *                recoverable VAT on installment / BNPL purchases (these post
 *                input VAT to 1180 without ever creating an expense row).
 *
 * Both must agree; any gap means a split leg was dropped, voided or posted to
 * the wrong account.
 */

export const INPUT_VAT_CODES = ["1180", "1181", "1182"] as const;

export function isInputVatAccount(code?: string | null, name?: string | null): boolean {
  if (code && (INPUT_VAT_CODES as readonly string[]).includes(code)) return true;
  const n = (name ?? "").toLowerCase();
  return n.includes("input vat") || n.includes("vat recoverable");
}

export interface VatLedgerLine {
  batch_id: string | null;
  debit?: number | null;
  credit?: number | null;
  transaction_date?: string | null;
  is_voided?: boolean | null;
  account_code?: string | null;
  account_name?: string | null;
}

export interface VatBatchMeta {
  id: string;
  reference_number?: string | null;
  journal_type?: string | null;
  batch_date?: string | null;
  is_posted?: boolean | null;
}

export interface VatBatchRow {
  batchId: string;
  reference: string;
  journalType: string;
  date: string;
  vat: number;
  lines: number;
  posted: boolean;
}

export interface VatReconciliationResult {
  batches: VatBatchRow[];
  ledgerTotal: number;
  sourceTotal: number;
  expensesVat: number;
  purchasesVat: number;
  installmentsVat: number;
  difference: number;
  /** True when ledger and source agree within tolerance. */
  matched: boolean;
  unbatchedVat: number;
}

export function reconcileVatRecoverable(params: {
  lines: VatLedgerLine[];
  batches: VatBatchMeta[];
  expensesVat: number;
  purchasesVat: number;
  /** VAT on installment (BNPL) purchases posted straight to the ledger. */
  installmentsVat?: number;
  tolerance?: number;
}): VatReconciliationResult {
  const { lines, batches, expensesVat, purchasesVat } = params;
  const installmentsVat = params.installmentsVat ?? 0;
  const tolerance = params.tolerance ?? 0.02;

  const meta = new Map(batches.map((b) => [b.id, b]));
  const grouped = new Map<string, VatBatchRow>();
  let ledgerTotal = 0;
  let unbatchedVat = 0;

  for (const l of lines) {
    if (l.is_voided) continue;
    const net = Number(l.debit || 0) - Number(l.credit || 0);
    if (net === 0) continue;
    ledgerTotal += net;

    if (!l.batch_id) {
      unbatchedVat += net;
      continue;
    }
    const b = meta.get(l.batch_id);
    const existing = grouped.get(l.batch_id);
    if (existing) {
      existing.vat += net;
      existing.lines += 1;
    } else {
      grouped.set(l.batch_id, {
        batchId: l.batch_id,
        reference: b?.reference_number || l.batch_id.slice(0, 8),
        journalType: b?.journal_type || "—",
        date: b?.batch_date || l.transaction_date || "",
        vat: net,
        lines: 1,
        posted: b?.is_posted ?? true,
      });
    }
  }

  const sourceTotal = round2(expensesVat + purchasesVat + installmentsVat);
  ledgerTotal = round2(ledgerTotal);
  const difference = round2(ledgerTotal - sourceTotal);

  return {
    batches: [...grouped.values()]
      .map((b) => ({ ...b, vat: round2(b.vat) }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    ledgerTotal,
    sourceTotal,
    expensesVat: round2(expensesVat),
    purchasesVat: round2(purchasesVat),
    installmentsVat: round2(installmentsVat),
    difference,
    matched: Math.abs(difference) <= tolerance,
    unbatchedVat: round2(unbatchedVat),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A BNPL / installment plan row as stored in `installment_plans`. */
export interface InstallmentVatPlan {
  vat_amount?: number | null;
  finance_vat_amount?: number | null;
  status?: string | null;
  branch_id?: string | null;
  purchase_date?: string | null;
}

/**
 * Recoverable input VAT carried by installment (BNPL) purchases for a given
 * branch/date scope. These post DR 1180 straight to the ledger without ever
 * creating an expense or purchase-invoice row, so they must be counted on the
 * source side or the reconciliation shows a phantom gap.
 *
 * Cancelled plans are excluded — their ledger legs are reversed.
 */
export function sumInstallmentVat(
  plans: InstallmentVatPlan[],
  scope?: { branchId?: string | null; dateFrom?: string; dateTo?: string },
): number {
  const branchId = scope?.branchId ?? null;
  const from = scope?.dateFrom;
  const to = scope?.dateTo;

  const total = plans.reduce((sum, p) => {
    if ((p.status ?? "").toLowerCase() === "cancelled") return sum;
    if (branchId && p.branch_id !== branchId) return sum;
    const d = p.purchase_date ?? undefined;
    if (from && (!d || d < from)) return sum;
    if (to && (!d || d > to)) return sum;
    return sum + Number(p.vat_amount || 0) + Number(p.finance_vat_amount || 0);
  }, 0);

  return round2(total);
}

/** One installment plan's contribution to recoverable input VAT. */
export interface InstallmentVatComponentRow {
  id: string;
  label: string;
  purchaseDate: string;
  branchId: string | null;
  goodsVat: number;
  financeVat: number;
  totalVat: number;
  excluded: boolean;
  excludedReason?: "cancelled";
}

export interface InstallmentVatBreakdown {
  rows: InstallmentVatComponentRow[];
  goodsVat: number;
  financeVat: number;
  totalVat: number;
  excludedVat: number;
}

/**
 * Splits the installment (BNPL) source-side VAT into its goods and
 * finance-charge components, per plan, so a reconciliation gap can be traced
 * to the exact leg that produced it. Cancelled plans are listed but excluded
 * from the totals (their ledger legs are reversed).
 */
export function breakdownInstallmentVat(
  plans: (InstallmentVatPlan & {
    id?: string | null;
    description?: string | null;
    supplier_name?: string | null;
    provider?: string | null;
  })[],
  scope?: { branchId?: string | null; dateFrom?: string; dateTo?: string },
): InstallmentVatBreakdown {
  const branchId = scope?.branchId ?? null;
  const from = scope?.dateFrom;
  const to = scope?.dateTo;

  const rows: InstallmentVatComponentRow[] = [];
  plans.forEach((p, i) => {
    if (branchId && p.branch_id !== branchId) return;
    const d = p.purchase_date ?? undefined;
    if (from && (!d || d < from)) return;
    if (to && (!d || d > to)) return;

    const goodsVat = round2(Number(p.vat_amount || 0));
    const financeVat = round2(Number(p.finance_vat_amount || 0));
    if (goodsVat === 0 && financeVat === 0) return;

    const cancelled = (p.status ?? "").toLowerCase() === "cancelled";
    rows.push({
      id: String(p.id ?? `plan-${i}`),
      label: p.description || p.supplier_name || p.provider || "Installment purchase",
      purchaseDate: d ?? "",
      branchId: p.branch_id ?? null,
      goodsVat,
      financeVat,
      totalVat: round2(goodsVat + financeVat),
      excluded: cancelled,
      excludedReason: cancelled ? "cancelled" : undefined,
    });
  });

  rows.sort((a, b) => (a.purchaseDate < b.purchaseDate ? 1 : a.purchaseDate > b.purchaseDate ? -1 : 0));

  const active = rows.filter((r) => !r.excluded);
  return {
    rows,
    goodsVat: round2(active.reduce((s, r) => s + r.goodsVat, 0)),
    financeVat: round2(active.reduce((s, r) => s + r.financeVat, 0)),
    totalVat: round2(active.reduce((s, r) => s + r.totalVat, 0)),
    excludedVat: round2(rows.filter((r) => r.excluded).reduce((s, r) => s + r.totalVat, 0)),
  };
}
