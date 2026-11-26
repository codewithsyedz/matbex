/**
 * Split tender: how a POS sale was paid. Pure rules (no database), used by
 * POST /api/v1/pos/sales and the void mirror; see docs/plans/split-payments.md.
 *
 * A sale is paid by one or more tenders. The request either lists them in `payments`
 * or uses the original single-method shape (`paymentMethod` + optional `cardTerminal`),
 * which old POS builds and the offline replay queue still send; that becomes one tender.
 *
 * Rules, checked against the server-priced total:
 * - tender amounts add up to the total, each one positive;
 * - only cash may be over-tendered: change = tendered - amount;
 * - a card tender paid on an integrated terminal (Hala / Moyasar) carries its own
 *   approval for exactly its amount; one approval never pays two tenders
 *   (Moyasar intents are checked against the database by the caller);
 * - at most one `other` tender, at most MAX_TENDERS in all;
 * - credit (unpaid) sales are not split.
 */
import { badRequest, HttpError } from "../../lib/errors.js";
import { roundMoney, sumMoney } from "../../../../src/lib/vatInclusive.ts";

export type TenderMethod = "cash" | "card" | "other";

export interface CardTerminal {
  provider: "hala" | "moyasar";
  status: string;
  reference?: string | null;
  response?: Record<string, unknown> | null;
}

export interface PaymentInput {
  method: TenderMethod;
  amount: number;
  /** Cash only: what the customer handed over (>= amount). */
  tendered?: number | null;
  cardTerminal?: CardTerminal | null;
}

export interface Tender {
  method: TenderMethod;
  amount: number;
  tendered: number | null;
  changeGiven: number | null;
  cardTerminal: CardTerminal | null;
}

export const MAX_TENDERS = 10;

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * The tenders of a sale, from either request shape. `total` is the server-priced,
 * VAT-inclusive sale total.
 */
export function resolveTenders(
  input: { paymentMethod?: TenderMethod | "split" | null; cardTerminal?: CardTerminal | null; payments?: PaymentInput[] | null },
  total: number,
  { settlement = "paid" }: { settlement?: "paid" | "unpaid" } = {},
): Tender[] {
  const payments = input.payments ?? null;

  if (!payments) {
    // Original shape: one method for the whole sale.
    const method = input.paymentMethod;
    if (!method) throw badRequest("paymentMethod or payments is required", "payment_required");
    if (method === "split") throw badRequest("A split sale lists its tenders in payments", "payments_required");
    const card = input.cardTerminal ?? null;
    if (card) {
      if (method !== "card") throw badRequest("A card terminal approval needs payment method card", "card_terminal_mismatch");
      if (card.status !== "approved") throw badRequest("The card terminal did not approve the charge", "card_not_approved");
    }
    return [{ method, amount: roundMoney(total), tendered: null, changeGiven: null, cardTerminal: card }];
  }

  if (input.cardTerminal) throw badRequest("Put the card approval on its card tender in payments", "card_terminal_mismatch");
  if (!payments.length) throw badRequest("payments needs at least one tender", "payments_required");
  if (payments.length > MAX_TENDERS) throw badRequest(`At most ${MAX_TENDERS} tenders per sale`, "too_many_tenders");
  if (settlement === "unpaid" && payments.length > 1) {
    throw badRequest("A credit (unpaid) sale cannot be split", "split_not_for_credit");
  }
  if (input.paymentMethod) {
    const expected = payments.length > 1 ? "split" : payments[0].method;
    if (input.paymentMethod !== expected) {
      throw badRequest(`paymentMethod must be ${expected} for these payments`, "payment_method_mismatch");
    }
  }
  if (payments.filter((p) => p.method === "other").length > 1) {
    throw badRequest("At most one 'other' tender per sale", "duplicate_other");
  }

  const refs = new Set<string>();
  const tenders = payments.map((p, i): Tender => {
    const amount = roundMoney(p.amount);
    if (!(amount > 0)) throw badRequest(`Tender ${i + 1}: amount must be positive`, "tender_amount_invalid");
    let tendered: number | null = null;
    let changeGiven: number | null = null;
    if (p.tendered != null) {
      if (p.method !== "cash") throw badRequest(`Tender ${i + 1}: only cash can be over-tendered`, "tendered_not_cash");
      tendered = roundMoney(p.tendered);
      if (tendered < amount - 0.004) throw badRequest(`Tender ${i + 1}: cash handed over is less than its amount`, "tendered_too_low");
      changeGiven = roundMoney(tendered - amount);
    }
    const card = p.cardTerminal ?? null;
    if (card) {
      if (p.method !== "card") throw badRequest(`Tender ${i + 1}: a card approval needs method card`, "card_terminal_mismatch");
      if (card.status !== "approved") throw badRequest(`Tender ${i + 1}: the card terminal did not approve the charge`, "card_not_approved");
      const ref = card.reference ? `${card.provider}:${card.reference}` : null;
      if (ref) {
        if (refs.has(ref)) throw badRequest(`Tender ${i + 1}: this card approval already pays another tender`, "card_already_used");
        refs.add(ref);
      }
      const approved = approvedAmount(card);
      if (approved != null && !near(approved, amount)) {
        throw badRequest(
          `Tender ${i + 1}: the terminal approved ${approved.toFixed(2)}, not ${amount.toFixed(2)}`,
          "card_amount_mismatch",
        );
      }
    }
    return { method: p.method, amount, tendered, changeGiven, cardTerminal: card };
  });

  const paid = sumMoney(tenders.map((t) => t.amount));
  if (!near(paid, roundMoney(total))) {
    throw new HttpError(
      400,
      `Tenders add up to ${paid.toFixed(2)}, the sale total is ${roundMoney(total).toFixed(2)}`,
      "tender_sum_mismatch",
      { paid, total: roundMoney(total) },
    );
  }
  return tenders;
}

/** The sale's payment_method: the one method, or 'split' for several tenders. */
export function saleMethod(tenders: Tender[]): TenderMethod | "split" {
  return tenders.length === 1 ? tenders[0].method : "split";
}

/** The amount a Hala terminal response says it approved, when it says (Moyasar is checked in the database). */
function approvedAmount(card: CardTerminal): number | null {
  if (card.provider !== "hala") return null;
  const raw = card.response?.amount;
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) ? roundMoney(n) : null;
}

/** Negated tenders for a void mirror; cash details are not repeated. */
export function mirrorTenders(tenders: { method: TenderMethod; amount: number; card_provider?: string | null; card_reference?: string | null }[]) {
  return tenders.map((t) => ({ method: t.method, amount: -roundMoney(t.amount), cardProvider: t.card_provider ?? null, cardReference: t.card_reference ?? null }));
}
