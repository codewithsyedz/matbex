import { test } from "node:test";
import { strictEqual } from "node:assert/strict";
import Fastify from "fastify";
import { createSaleBody, quoteSaleBody } from "./sales.schema.ts";

// Validated by Fastify's own AJV, as the real route is.
async function status(body: unknown, schema: object = createSaleBody) {
  const app = Fastify();
  app.post("/", { schema: { body: schema } }, async () => ({ ok: true }));
  const res = await app.inject({ method: "POST", url: "/", payload: body as object });
  await app.close();
  return res.statusCode;
}

const id = "9f1e72df-368e-49a4-a669-f4fbfb75585e";
const base = { restaurantId: id, lines: [{ menuItemId: id, quantity: 1 }] };

test("a cash sale may send cardTerminal: null (the POS does)", async () => {
  strictEqual(await status({ ...base, paymentMethod: "cash", cardTerminal: null }), 200);
});

test("split tenders may send cardTerminal: null on cash and manual card tenders", async () => {
  const payments = [
    { method: "cash", amount: 30, tendered: null, cardTerminal: null },
    { method: "card", amount: 16, cardTerminal: null },
  ];
  strictEqual(await status({ ...base, payments }), 200);
});

test("a malformed card approval is still refused", async () => {
  strictEqual(await status({ ...base, paymentMethod: "card", cardTerminal: { provider: "other" } }), 400);
});

test("a sale needs a payment, a quote does not (split checkout quotes before payments are sent)", async () => {
  strictEqual(await status(base), 400);
  strictEqual(await status(base, quoteSaleBody), 200);
});
