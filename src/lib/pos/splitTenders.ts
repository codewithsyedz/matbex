/**
 * Split tender (docs/plans/split-payments.md): the tenders a cashier enters on the POS payment
 * step, and the rules the server checks again (server/src/modules/pos/tenders.ts): tenders add
 * up to the total, only cash is over-tendered, each card tender has its own approval.
 */
import { useCallback, useMemo, useState } from "react";
import { roundMoney, sumMoney } from "@/lib/vatInclusive";
import type { CardTerminalApproval, SaleTender } from "@/lib/api/pos";

export type TenderMethod = "cash" | "card" | "other";

/** One tender of a split payment, as the cashier enters it. */
export interface DraftTender {
  id: string;
  method: TenderMethod;
  /** Amount of the sale this tender pays (text input). */
  amount: string;
  /** Cash only: what the customer handed over (change = tendered - amount). */
  tendered: string;
  /** Set once the terminal approved this tender; it is not charged again on retry. */
  approval?: CardTerminalApproval | null;
}

/** A tender ready to charge / send: amount parsed. */
export interface TenderPart extends DraftTender {
  amt: number;
}

export const money = (v: string) => roundMoney(parseFloat(v) || 0);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Tenders with a positive amount, parsed. */
export function tenderParts(tenders: DraftTender[]): TenderPart[] {
  return tenders.map((d) => ({ ...d, amt: money(d.amount) })).filter((d) => d.amt > 0);
}

/** True when the tenders pay exactly `total` with at least two of them and no cash is short. */
export function splitIsComplete(tenders: DraftTender[], total: number): boolean {
  const parts = tenderParts(tenders);
  return (
    parts.length >= 2 &&
    near(sumMoney(parts.map((p) => p.amt)), roundMoney(total)) &&
    parts.every((p) => p.method !== "cash" || !p.tendered.trim() || money(p.tendered) >= p.amt) &&
    parts.filter((p) => p.method === "other").length <= 1
  );
}

/** The request's `payments` from the entered tenders. */
export function toSalePayments(parts: TenderPart[]): SaleTender[] {
  return parts.map((p) => ({
    method: p.method,
    amount: p.amt,
    tendered: p.method === "cash" && p.tendered.trim() ? money(p.tendered) : null,
    cardTerminal: p.method === "card" ? p.approval ?? null : null,
  }));
}

/** Printable tenders (receipts): amount, cash given and change. */
export function receiptTenders(parts: TenderPart[]) {
  return toSalePayments(parts).map((p) => ({
    method: p.method,
    amount: p.amount,
    tendered: p.tendered ?? null,
    change_given: p.tendered != null ? roundMoney(p.tendered - p.amount) : null,
  }));
}

/**
 * Charges every card tender not yet approved, one after the other, with `charge` (the
 * terminal or gateway for that amount). Each approval is stored at once (`onApproved`), so
 * a declined card stops the sale but keeps the cards already charged.
 */
export async function chargeCardTenders(
  parts: TenderPart[],
  charge: (amount: number, tender: TenderPart) => Promise<CardTerminalApproval>,
  onApproved: (id: string, approval: CardTerminalApproval) => void,
) {
  for (const p of parts) {
    if (p.method !== "card" || p.approval) continue;
    const approval = await charge(p.amt, p);
    p.approval = approval;
    onApproved(p.id, approval);
  }
}

export function useSplitTenders(total: number) {
  const [tenders, setTenders] = useState<DraftTender[]>([]);
  const tenderSum = sumMoney(tenders.map((d) => money(d.amount)));
  const remaining = roundMoney(roundMoney(total) - tenderSum);
  const ready = useMemo(() => splitIsComplete(tenders, total), [tenders, total]);
  const addTender = useCallback(
    (method: TenderMethod, amount: number) =>
      setTenders((prev) => [...prev, { id: crypto.randomUUID(), method, amount: amount > 0 ? amount.toFixed(2) : "", tendered: "" }]),
    [],
  );
  const updateTender = useCallback(
    (id: string, patch: Partial<DraftTender>) => setTenders((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d))),
    [],
  );
  const removeTender = useCallback((id: string) => setTenders((prev) => prev.filter((d) => d.id !== id || !!d.approval)), []);
  const markApproved = useCallback(
    (id: string, approval: CardTerminalApproval) => setTenders((prev) => prev.map((d) => (d.id === id ? { ...d, approval } : d))),
    [],
  );
  const reset = useCallback(() => setTenders([]), []);
  return { tenders, remaining, ready, addTender, updateTender, removeTender, markApproved, reset };
}

export type SplitTenders = ReturnType<typeof useSplitTenders>;

