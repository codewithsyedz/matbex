import { test } from "node:test";
import { deepStrictEqual as eq, strictEqual, throws } from "node:assert/strict";
import Fastify from "fastify";
import { HttpError } from "../../lib/errors.js";
import { assertPartsMatchCart, spreadAmount } from "./bill-split.ts";
import { billSplitBody, billSplitQuoteBody } from "./bill-split.schema.ts";

const code = (c: string) => (e: unknown) => e instanceof HttpError && e.code === c;
const A = "9f1e72df-368e-49a4-a669-f4fbfb75585e";
const B = "84e4459f-368e-49a4-a669-f4fbfb75585e";
const C = "11111111-368e-49a4-a669-f4fbfb75585e";

const cart = [
  { menuItemId: A, quantity: 3, unitPrice: 10 },
  { menuItemId: B, size: "half" as const, quantity: 1, unitPrice: 25 },
  { comboId: C, quantity: 1, unitPrice: 40 },
];

test("parts that are exactly the cart pass, units of a line may go to different guests", () => {
  assertPartsMatchCart(cart, [
    { lines: [{ menuItemId: A, quantity: 2, unitPrice: 10 }, { comboId: C, quantity: 1, unitPrice: 40 }] },
    { lines: [{ menuItemId: A, quantity: 1, unitPrice: 10 }, { menuItemId: B, size: "half", quantity: 1, unitPrice: 25 }] },
  ]);
});

test("missing, extra or changed lines are refused", () => {
  // missing: one unit of A
  throws(() => assertPartsMatchCart(cart, [
    { lines: [{ menuItemId: A, quantity: 2, unitPrice: 10 }, { comboId: C, quantity: 1, unitPrice: 40 }] },
    { lines: [{ menuItemId: B, size: "half", quantity: 1, unitPrice: 25 }] },
  ]), code("parts_not_cart"));
  // extra: one more A
  throws(() => assertPartsMatchCart(cart, [
    { lines: [{ menuItemId: A, quantity: 3, unitPrice: 10 }, { comboId: C, quantity: 1, unitPrice: 40 }] },
    { lines: [{ menuItemId: A, quantity: 1, unitPrice: 10 }, { menuItemId: B, size: "half", quantity: 1, unitPrice: 25 }] },
  ]), code("parts_not_cart"));
  // changed size
  throws(() => assertPartsMatchCart(cart, [
    { lines: [{ menuItemId: A, quantity: 3, unitPrice: 10 }, { comboId: C, quantity: 1, unitPrice: 40 }] },
    { lines: [{ menuItemId: B, size: "full", quantity: 1, unitPrice: 25 }] },
  ]), code("parts_not_cart"));
  // changed price
  throws(() => assertPartsMatchCart(cart, [
    { lines: [{ menuItemId: A, quantity: 3, unitPrice: 9 }, { comboId: C, quantity: 1, unitPrice: 40 }] },
    { lines: [{ menuItemId: B, size: "half", quantity: 1, unitPrice: 25 }] },
  ]), code("parts_not_cart"));
  // a line the cart never had
  throws(() => assertPartsMatchCart(cart, [
    { lines: [...cart] },
    { lines: [{ menuItemId: C, quantity: 1, unitPrice: 1 }] },
  ]), code("parts_not_cart"));
});

test("a split bill needs 2..20 non-empty parts", () => {
  throws(() => assertPartsMatchCart(cart, [{ lines: cart }]), code("too_few_parts"));
  throws(() => assertPartsMatchCart(cart, [{ lines: cart }, { lines: [] }]), code("empty_part"));
});

test("the parts' error lists what is missing and what is extra", () => {
  try {
    assertPartsMatchCart(cart, [{ lines: [cart[0], cart[1]] }, { lines: [{ menuItemId: A, quantity: 1, unitPrice: 10 }] }]);
  } catch (e) {
    const d = (e as HttpError).details as { missing: { line: string; quantity: number }[]; extra: { line: string; quantity: number }[] };
    eq(d.missing, [{ line: `combo:${C}|regular|40.00`, quantity: 1 }]);
    eq(d.extra, [{ line: `item:${A}|regular|10.00`, quantity: 1 }]);
    return;
  }
  throw new Error("expected parts_not_cart");
});

test("discount spreading: proportional to each part's lines, last part takes the rounding", () => {
  eq(spreadAmount(10, [60, 40]), [6, 4]);
  eq(spreadAmount(10, [1, 1, 1]), [3.33, 3.33, 3.34]);
  eq(spreadAmount(0.05, [1, 1, 1, 1, 1, 1]), [0, 0, 0, 0, 0, 0.05]);
  eq(spreadAmount(7.77, [33.5, 12.25, 54.25]), [2.6, 0.95, 4.22]);
  eq(spreadAmount(5, [0, 0]), [0, 5]);
  for (const [amount, weights] of [[12.34, [7, 3, 11]], [0.01, [1, 1]], [99.99, [10.1, 20.2, 30.3, 40.4]]] as const) {
    const s = spreadAmount(amount, [...weights]);
    strictEqual(Math.round(s.reduce((a, b) => a + b, 0) * 100), Math.round(amount * 100));
    for (const x of s) strictEqual(x >= 0, true);
  }
});

// Validated by Fastify's own AJV, as the real route is.
async function status(body: unknown, schema: object = billSplitBody) {
  const app = Fastify();
  app.post("/", { schema: { body: schema } }, async () => ({ ok: true }));
  const res = await app.inject({ method: "POST", url: "/", payload: body as object });
  await app.close();
  return res.statusCode;
}

const body = {
  restaurantId: A,
  lines: [{ menuItemId: A, quantity: 2 }],
  parts: [
    { lines: [{ menuItemId: A, quantity: 1 }], payments: [{ method: "cash", amount: 11.5, tendered: null, cardTerminal: null }] },
    { lines: [{ menuItemId: A, quantity: 1 }], payments: [{ method: "card", amount: 11.5, cardTerminal: null }] },
  ],
};

test("schema: parts with payments (cardTerminal: null allowed); a quote needs no payments", async () => {
  strictEqual(await status(body), 200);
  const noPay = { ...body, parts: body.parts.map((p) => ({ lines: p.lines })) };
  strictEqual(await status(noPay), 400);
  strictEqual(await status(noPay, billSplitQuoteBody), 200);
  strictEqual(await status({ ...body, parts: [body.parts[0]] }), 400);
  strictEqual(await status({ ...body, offline: { receiptNumbers: ["OFF-1", "OFF-2"], createdAt: new Date().toISOString() } }), 200);
});
