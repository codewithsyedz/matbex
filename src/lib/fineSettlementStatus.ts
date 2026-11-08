/**
 * Settlement maths for employee fines.
 *
 * A fine can stand alone or be one row of an installment plan. In both cases we
 * want a single answer: how much of the *total* fine has already been recovered
 * from payroll, and how much is still due across the remaining installments.
 */

export interface FineSettlementRow {
  id: string;
  amount: number | string | null;
  recovered_amount?: number | string | null;
  status: string;
  applied_payroll_id?: string | null;
  installment_group_id?: string | null;
  installment_total_amount?: number | string | null;
}

export interface FineSettlement {
  /** Total value of the fine (whole plan when part of an installment schedule). */
  total: number;
  /** Amount already recovered from payroll. */
  recovered: number;
  /** Amount still to be deducted from future payrolls. */
  due: number;
  /** Percentage recovered, 0-100. */
  percent: number;
  /** Installments already deducted / total live installments. */
  paidInstallments: number;
  totalInstallments: number;
  state: "unrecovered" | "partial" | "settled" | "cancelled";
}

const num = (v: number | string | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : v ?? 0;
  return Number.isFinite(n as number) ? (n as number) : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Amount of a single row that has already been taken out of a salary. */
export function rowRecovered(row: FineSettlementRow): number {
  const applied = row.status === "applied" || !!row.applied_payroll_id;
  return round2(Math.max(num(row.recovered_amount), applied ? num(row.amount) : 0));
}

const isLive = (row: FineSettlementRow) => row.status !== "cancelled" && row.status !== "rejected";

/**
 * Builds a settlement summary per fine id. Rows belonging to the same
 * installment group share the same plan-level totals.
 */
export function computeFineSettlements(
  rows: FineSettlementRow[],
): Record<string, FineSettlement> {
  const groups = new Map<string, FineSettlementRow[]>();
  const standalone: FineSettlementRow[] = [];

  for (const row of rows) {
    if (row.installment_group_id) {
      const list = groups.get(row.installment_group_id) ?? [];
      list.push(row);
      groups.set(row.installment_group_id, list);
    } else {
      standalone.push(row);
    }
  }

  const result: Record<string, FineSettlement> = {};

  const finish = (
    ids: string[],
    total: number,
    recovered: number,
    paidInstallments: number,
    totalInstallments: number,
    cancelled: boolean,
  ) => {
    const t = round2(total);
    const r = round2(Math.min(recovered, t));
    const due = round2(Math.max(0, t - r));
    const settlement: FineSettlement = {
      total: t,
      recovered: r,
      due,
      percent: t > 0 ? Math.min(100, Math.round((r / t) * 100)) : 0,
      paidInstallments,
      totalInstallments,
      state: cancelled ? "cancelled" : due <= 0.004 ? "settled" : r > 0.004 ? "partial" : "unrecovered",
    };
    for (const id of ids) result[id] = settlement;
  };

  for (const row of standalone) {
    const recovered = rowRecovered(row);
    finish(
      [row.id],
      num(row.amount),
      recovered,
      recovered > 0.004 ? 1 : 0,
      1,
      row.status === "cancelled",
    );
  }

  for (const [, list] of groups) {
    const live = list.filter(isLive);
    const declared = Math.max(0, ...list.map((r) => num(r.installment_total_amount)));
    const summed = live.reduce((s, r) => s + num(r.amount), 0);
    // Cancelled rows still count towards recovery if they were deducted first.
    const recoveredFromCancelled = list
      .filter((r) => !isLive(r))
      .reduce((s, r) => s + rowRecovered(r), 0);
    const recovered = live.reduce((s, r) => s + rowRecovered(r), 0) + recoveredFromCancelled;
    const total = Math.max(declared, summed, recovered);
    const paid = live.filter((r) => rowRecovered(r) > 0.004).length + 
      list.filter((r) => !isLive(r) && rowRecovered(r) > 0.004).length;
    finish(
      list.map((r) => r.id),
      total,
      recovered,
      paid,
      Math.max(live.length, paid),
      live.length === 0,
    );
  }

  return result;
}
