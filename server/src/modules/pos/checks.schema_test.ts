import { test } from "node:test";
import { strictEqual } from "node:assert/strict";
import Fastify from "fastify";
import { addLinesBody, openBody, payBody } from "./checks.schema.ts";

// Validated by Fastify's own AJV, as the real routes are.
async function status(schema: object, body: unknown) {
  const app = Fastify();
  app.post("/", { schema: { body: schema } }, async () => ({ ok: true }));
  const res = await app.inject({ method: "POST", url: "/", payload: body as object });
  await app.close();
  return res.statusCode;
}

const id = "9f1e72df-368e-49a4-a669-f4fbfb75585e";
const line = { menuItemId: id, quantity: 1, unitPrice: 23, note: "no onions" };

test("open: a table or a name, optional lines and send", async () => {
  strictEqual(await status(openBody, { restaurantId: id, tableId: id }), 200);
  strictEqual(await status(openBody, { restaurantId: id, name: "Bar", lines: [line], send: true }), 200);
  strictEqual(await status(openBody, { restaurantId: id, lines: [{ quantity: 1 }] }), 400);
});

test("add lines needs at least one line; quantities are whole and positive", async () => {
  strictEqual(await status(addLinesBody, { restaurantId: id, lines: [line] }), 200);
  strictEqual(await status(addLinesBody, { restaurantId: id, lines: [] }), 400);
  strictEqual(await status(addLinesBody, { restaurantId: id, lines: [{ ...line, quantity: 0 }] }), 400);
});

test("pay takes payments or parts, not both and not neither; cardTerminal: null is fine", async () => {
  const payments = [{ method: "cash", amount: 23, tendered: null, cardTerminal: null }];
  strictEqual(await status(payBody, { restaurantId: id, payments }), 200);
  strictEqual(await status(payBody, { restaurantId: id, parts: [{ lines: [{ menuItemId: id, quantity: 1, unitPrice: 23 }], payments }, { lines: [{ menuItemId: id, quantity: 1, unitPrice: 23 }], payments }] }), 200);
  strictEqual(await status(payBody, { restaurantId: id }), 400);
  strictEqual(await status(payBody, { restaurantId: id, payments, parts: [] }), 400);
});
