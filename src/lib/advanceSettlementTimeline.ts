/**
 * Settlement history timeline for a staff advance.
 *
 * Merges the advance lifecycle (recorded / posted / deducted / forgiven /
 * reversed), every repayment, and any audit-log entries into one
 * chronological list with a running outstanding balance, so reviewers can
 * follow the full settlement story of an advance over time.
 */

export type TimelineKind =
  | "recorded"
  | "posted"
  | "repayment"
  | "deduction"
  | "forgiven"
  | "reversal"
  | "audit";

export interface TimelineAdvance {
  amount: number;
  created_at?: string | null;
  advance_date?: string | null;
  deducted_at?: string | null;
  updated_at?: string | null;
  status?: string | null;
  ledger_reversed?: boolean | null;
  ledger_reversed_at?: string | null;
  ledger_reversal_reason?: string | null;
  staff?: { name?: string | null } | null;
}

export interface TimelineRepayment {
  id: string;
  amount: number | null;
  repayment_date: string;
  source?: string | null;
  notes?: string | null;
  created_at?: string | null;
  ledger_transaction_id?: string | null;
}

export interface TimelineLeg {
  id: string;
  created_at: string;
  reference_type?: string | null;
  debit?: number | null;
  credit?: number | null;
  is_voided?: boolean | null;
}

export interface TimelineAuditLog {
  id: string;
  action: string;
  created_at: string;
  new_data?: unknown;
}

export interface SettlementTimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  /** Signed change to the outstanding balance (negative = reduces due). */
  delta?: number | null;
  /** Outstanding balance after this event. */
  balance?: number | null;
  ledgerLinked: boolean;
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ts = (v: unknown) => (typeof v === "string" && v ? v : null);

const sourceLabel = (source?: string | null) => {
  switch ((source ?? "").toLowerCase()) {
    case "cash":
      return "Cash in hand";
    case "bank":
      return "Bank transfer";
    case "payroll":
      return "Payroll deduction";
    default:
      return source ? source : "Repayment";
  }
};

export function buildAdvanceSettlementTimeline(input: {
  advance?: TimelineAdvance | null;
  repayments?: TimelineRepayment[];
  legs?: TimelineLeg[];
  auditLogs?: TimelineAuditLog[];
}): SettlementTimelineEvent[] {
  const { advance, repayments = [], legs = [], auditLogs = [] } = input;
  const events: SettlementTimelineEvent[] = [];
  if (!advance) return events;

  const amount = round2(Number(advance.amount) || 0);
  const createdAt = ts(advance.created_at) ?? ts(advance.advance_date) ?? "";

  events.push({
    id: "recorded",
    at: createdAt,
    kind: "recorded",
    title: "Advance recorded",
    detail: advance.staff?.name ? `Issued to ${advance.staff.name}` : null,
    delta: amount,
    ledgerLinked: false,
  });

  const originalLegs = legs.filter((l) => l.reference_type === "staff_advance");
  if (originalLegs.length) {
    const postedAt = originalLegs.reduce(
      (min, l) => (l.created_at < min ? l.created_at : min),
      originalLegs[0].created_at,
    );
    events.push({
      id: "posted",
      at: postedAt,
      kind: "posted",
      title: "Posted to ledger",
      detail: `${originalLegs.length} journal leg${originalLegs.length === 1 ? "" : "s"} · DR 1150 employee advances`,
      ledgerLinked: true,
    });
  }

  for (const r of repayments) {
    const value = round2(Number(r.amount) || 0);
    events.push({
      id: `repayment-${r.id}`,
      at: ts(r.created_at) ?? `${r.repayment_date}T00:00:00.000Z`,
      kind: "repayment",
      title: `Repayment · ${sourceLabel(r.source)}`,
      detail: r.notes ?? null,
      delta: -value,
      ledgerLinked: !!r.ledger_transaction_id,
    });
  }

  if (advance.deducted_at) {
    events.push({
      id: "deducted",
      at: String(advance.deducted_at),
      kind: "deduction",
      title: "Settled through payroll",
      detail: "Advance marked as deducted from salary",
      ledgerLinked: legs.some((l) => l.reference_type === "advance_deduction"),
    });
  }

  if (advance.status === "forgiven") {
    events.push({
      id: "forgiven",
      at: ts(advance.updated_at) ?? createdAt,
      kind: "forgiven",
      title: "Advance forgiven",
      detail: "Written off — no longer recoverable from payroll",
      ledgerLinked: false,
    });
  }

  const reversalLegs = legs.filter((l) => l.reference_type === "staff_advance_reversal");
  if (advance.ledger_reversed || reversalLegs.length) {
    const reversedAt =
      ts(advance.ledger_reversed_at) ??
      (reversalLegs.length
        ? reversalLegs.reduce((min, l) => (l.created_at < min ? l.created_at : min), reversalLegs[0].created_at)
        : ts(advance.updated_at)) ??
      createdAt;
    events.push({
      id: "reversal",
      at: reversedAt,
      kind: "reversal",
      title: "Reversal journal posted",
      detail: advance.ledger_reversal_reason ?? "Original legs voided and offset by a mirrored entry",
      ledgerLinked: reversalLegs.length > 0,
    });
  }

  for (const log of auditLogs) {
    events.push({
      id: `audit-${log.id}`,
      at: log.created_at,
      kind: "audit",
      title: log.action
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase()),
      detail: "Audit log entry",
      ledgerLinked: false,
    });
  }

  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  // Running outstanding balance across value-changing events.
  let balance = 0;
  let closed = false;
  for (const ev of events) {
    if (ev.kind === "forgiven" || ev.kind === "reversal" || ev.kind === "deduction") {
      balance = 0;
      closed = true;
      ev.balance = 0;
      continue;
    }
    if (typeof ev.delta === "number") {
      balance = round2(Math.max(0, balance + ev.delta));
    }
    ev.balance = closed ? 0 : balance;
  }

  return events;
}

export function timelineFinalBalance(events: SettlementTimelineEvent[]): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (typeof events[i].balance === "number") return events[i].balance as number;
  }
  return 0;
}
