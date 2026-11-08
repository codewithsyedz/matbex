/**
 * Groups the raw journal legs of a staff advance into a per-account breakdown so
 * users can see exactly which account was debited, which was credited, and by
 * how much — across the original posting, repayments and reversals.
 */

export type AdvanceLegKind = "original" | "repayment" | "reversal" | "deduction" | "other";

export interface BreakdownLeg {
  id: string;
  debit?: number | null;
  credit?: number | null;
  is_voided?: boolean | null;
  reference_type?: string | null;
  description?: string | null;
  transaction_date?: string | null;
  chart_of_accounts?: { account_code: string; account_name: string } | null;
}

export interface AccountBreakdownRow {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  /** Positive = net debit, negative = net credit. */
  net: number;
  side: "debit" | "credit" | "none";
  legCount: number;
  kinds: AdvanceLegKind[];
}

export interface AdvanceLedgerBreakdown {
  rows: AccountBreakdownRow[];
  /** Accounts with a net credit — i.e. where the money came from / was returned to. */
  creditedAccounts: AccountBreakdownRow[];
  /** Accounts with a net debit — normally 1150 Employee Advances. */
  debitedAccounts: AccountBreakdownRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  legCount: number;
  voidedLegCount: number;
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function legKind(referenceType?: string | null): AdvanceLegKind {
  switch (referenceType) {
    case "staff_advance":
      return "original";
    case "staff_advance_repayment":
      return "repayment";
    case "staff_advance_reversal":
      return "reversal";
    case "advance_deduction":
      return "deduction";
    default:
      return "other";
  }
}

export function legKindLabel(kind: AdvanceLegKind): string {
  switch (kind) {
    case "original":
      return "Advance paid";
    case "repayment":
      return "Repayment";
    case "reversal":
      return "Reversal";
    case "deduction":
      return "Payroll deduction";
    default:
      return "Other";
  }
}

/** Builds the per-account breakdown. Voided legs are excluded from amounts. */
export function buildAdvanceLedgerBreakdown(legs: BreakdownLeg[]): AdvanceLedgerBreakdown {
  const byAccount = new Map<string, AccountBreakdownRow>();
  let totalDebit = 0;
  let totalCredit = 0;
  let voidedLegCount = 0;
  let legCount = 0;

  for (const leg of legs) {
    if (leg.is_voided) {
      voidedLegCount += 1;
      continue;
    }
    legCount += 1;
    const code = leg.chart_of_accounts?.account_code ?? "—";
    const name = leg.chart_of_accounts?.account_name ?? "Unmapped account";
    let row = byAccount.get(code);
    if (!row) {
      row = {
        accountCode: code,
        accountName: name,
        debit: 0,
        credit: 0,
        net: 0,
        side: "none",
        legCount: 0,
        kinds: [],
      };
      byAccount.set(code, row);
    }
    const dr = Number(leg.debit || 0);
    const cr = Number(leg.credit || 0);
    row.debit += dr;
    row.credit += cr;
    row.legCount += 1;
    const kind = legKind(leg.reference_type);
    if (!row.kinds.includes(kind)) row.kinds.push(kind);
    totalDebit += dr;
    totalCredit += cr;
  }

  const rows = Array.from(byAccount.values())
    .map((row) => {
      const debit = round2(row.debit);
      const credit = round2(row.credit);
      const net = round2(debit - credit);
      return {
        ...row,
        debit,
        credit,
        net,
        side: net > 0.005 ? ("debit" as const) : net < -0.005 ? ("credit" as const) : ("none" as const),
      };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  return {
    rows,
    creditedAccounts: rows.filter((r) => r.side === "credit"),
    debitedAccounts: rows.filter((r) => r.side === "debit"),
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    balanced: Math.abs(round2(totalDebit - totalCredit)) < 0.01,
    legCount,
    voidedLegCount,
  };
}

/** Human-readable summary of where the cash came from, e.g. "1000 · Cash in Hand". */
export function describeFundingAccounts(breakdown: AdvanceLedgerBreakdown): string {
  const originals = breakdown.creditedAccounts.filter((r) => r.kinds.includes("original"));
  const source = originals.length ? originals : breakdown.creditedAccounts;
  if (!source.length) return "No credited account posted yet";
  return source.map((r) => `${r.accountCode} · ${r.accountName}`).join(", ");
}
