import { test } from "node:test";
import { deepStrictEqual as eq, throws } from "node:assert/strict";
import { HttpError } from "../../lib/errors.js";
import { mirrorTenders, resolveTenders, saleMethod } from "./tenders.ts";

const code = (c: string) => (e: unknown) => e instanceof HttpError && e.code === c;
const hala = (amount: number, status = "approved", reference = `h-${amount}`) =>
  ({ provider: "hala" as const, status, reference, response: { amount } });

test("legacy single-method request becomes one tender of the whole total", () => {
  const t = resolveTenders({ paymentMethod: "cash" }, 115);
  eq(t, [{ method: "cash", amount: 115, tendered: null, changeGiven: null, cardTerminal: null }]);
  eq(saleMethod(t), "cash");
});

test("legacy card request keeps its terminal approval", () => {
  const t = resolveTenders({ paymentMethod: "card", cardTerminal: hala(50) }, 50);
  eq(t[0].cardTerminal?.reference, "h-50");
  throws(() => resolveTenders({ paymentMethod: "cash", cardTerminal: hala(50) }, 50), code("card_terminal_mismatch"));
  throws(() => resolveTenders({ paymentMethod: "card", cardTerminal: hala(50, "declined") }, 50), code("card_not_approved"));
});

test("cash + card split adds up to the server total", () => {
  const t = resolveTenders({ payments: [{ method: "cash", amount: 60, tendered: 100 }, { method: "card", amount: 40, cardTerminal: hala(40) }] }, 100);
  eq(saleMethod(t), "split");
  eq(t.map((x) => [x.method, x.amount, x.tendered, x.changeGiven]), [["cash", 60, 100, 40], ["card", 40, null, null]]);
});

test("tenders that do not add up to the total are refused", () => {
  throws(() => resolveTenders({ payments: [{ method: "cash", amount: 60 }, { method: "card", amount: 30 }] }, 100), code("tender_sum_mismatch"));
  throws(() => resolveTenders({ payments: [{ method: "cash", amount: 60 }, { method: "card", amount: 50 }] }, 100), code("tender_sum_mismatch"));
});

test("only cash may be over-tendered, and never under", () => {
  throws(() => resolveTenders({ payments: [{ method: "card", amount: 50, tendered: 60 }, { method: "cash", amount: 50 }] }, 100), code("tendered_not_cash"));
  throws(() => resolveTenders({ payments: [{ method: "cash", amount: 50, tendered: 40 }, { method: "card", amount: 50 }] }, 100), code("tendered_too_low"));
});

test("each card tender needs its own approval for its own amount", () => {
  throws(() => resolveTenders({ payments: [{ method: "card", amount: 50, cardTerminal: hala(50, "declined") }, { method: "cash", amount: 50 }] }, 100), code("card_not_approved"));
  throws(() => resolveTenders({ payments: [{ method: "card", amount: 50, cardTerminal: hala(50) }, { method: "card", amount: 50, cardTerminal: hala(50) }] }, 100), code("card_already_used"));
  throws(() => resolveTenders({ payments: [{ method: "card", amount: 40, cardTerminal: hala(100) }, { method: "cash", amount: 60 }] }, 100), code("card_amount_mismatch"));
  throws(() => resolveTenders({ payments: [{ method: "cash", amount: 40, cardTerminal: hala(40) }, { method: "card", amount: 60 }] }, 100), code("card_terminal_mismatch"));
  throws(() => resolveTenders({ cardTerminal: hala(100), payments: [{ method: "card", amount: 100 }] }, 100), code("card_terminal_mismatch"));
});

test("other rules: one 'other', no split credit sales, paymentMethod must agree", () => {
  throws(() => resolveTenders({ payments: [{ method: "other", amount: 50 }, { method: "other", amount: 50 }] }, 100), code("duplicate_other"));
  throws(() => resolveTenders({ payments: [{ method: "cash", amount: 50 }, { method: "card", amount: 50 }] }, 100, { settlement: "unpaid" }), code("split_not_for_credit"));
  throws(() => resolveTenders({ paymentMethod: "cash", payments: [{ method: "cash", amount: 50 }, { method: "card", amount: 50 }] }, 100), code("payment_method_mismatch"));
  throws(() => resolveTenders({ paymentMethod: "split" }, 100), code("payments_required"));
  throws(() => resolveTenders({ payments: [{ method: "cash", amount: 0 }, { method: "card", amount: 100 }] }, 100), code("tender_amount_invalid"));
  eq(saleMethod(resolveTenders({ paymentMethod: "split", payments: [{ method: "cash", amount: 50 }, { method: "card", amount: 50 }] }, 100)), "split");
});

test("rounding: tenders compare to the cent", () => {
  const t = resolveTenders({ payments: [{ method: "cash", amount: 33.33 }, { method: "card", amount: 33.33 }, { method: "other", amount: 33.34 }] }, 100);
  eq(t.length, 3);
});

test("void mirror negates every tender", () => {
  eq(mirrorTenders([{ method: "cash", amount: 60 }, { method: "card", amount: 40, card_provider: "moyasar", card_reference: "x" }]), [
    { method: "cash", amount: -60, cardProvider: null, cardReference: null },
    { method: "card", amount: -40, cardProvider: "moyasar", cardReference: "x" },
  ]);
});
