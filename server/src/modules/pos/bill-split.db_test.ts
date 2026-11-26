/**
 * Split bill against a real database (npm run test:db). Runs on the local database: each test
 * works in a transaction it rolls back, or in one that fails and so saves nothing; nothing is
 * left behind. Skips when no restaurant with an owner and two priced, active menu items exists.
 */
import { after, before, test } from "node:test";
import { deepStrictEqual as eq, ok, rejects, strictEqual } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { HttpError } from "../../lib/errors.js";
import type { Tx } from "../../db.js";
import * as schema from "../../db/generated/schema.js";
import { closeModuleDb, moduleSql, type ServiceTx } from "../shared/db.js";
import { createBillSplit, quoteBillSplit, recordBillSplit } from "./bill-split.service.js";
import type { BillSplitInput } from "./bill-split.schema.js";
import { voidSaleTx } from "./sales-admin.service.js";

type Fixture = { restaurantId: string; userId: string; a: { id: string; price: number }; b: { id: string; price: number } };
let fx: Fixture | null = null;
const claims = () => ({ sub: fx!.userId, role: "authenticated" as const });

before(async () => {
  const [row] = await moduleSql<{ restaurant_id: string; user_id: string; items: { id: string; price: number }[] }[]>`
    select ur.restaurant_id, ur.user_id,
           (select json_agg(json_build_object('id', m.id, 'price', m.selling_price::float8) order by m.selling_price)
              from (select * from public.menu_items m where m.restaurant_id = ur.restaurant_id and coalesce(m.is_active, true)
                      and m.selling_price > 0 limit 2) m) as items
    from public.user_roles ur
    where ur.role = 'owner'
      and (select count(*) from public.menu_items m where m.restaurant_id = ur.restaurant_id and coalesce(m.is_active, true) and m.selling_price > 0) >= 2
    limit 1`;
  if (row?.items?.length === 2) fx = { restaurantId: row.restaurant_id, userId: row.user_id, a: row.items[0], b: row.items[1] };
});
after(() => closeModuleDb());

const ROLLBACK = new Error("rollback");
/** Runs fn in a module transaction (claims set, like inServiceTx) and always rolls it back. */
async function rolledBack(fn: (t: ServiceTx) => Promise<void>) {
  await moduleSql
    .begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims())}, true)`;
      (tx as unknown as { options: unknown }).options ??= (moduleSql as unknown as { options: unknown }).options;
      await fn({ db: drizzle(tx as unknown as postgres.Sql, { schema }), tx: tx as unknown as Tx });
      throw ROLLBACK;
    })
    .catch((e) => { if (e !== ROLLBACK) throw e; });
}

/** Cart: 2 × A + 1 × B; guest 1 gets A + B, guest 2 gets the other A. */
function cartSplit(discount = 0): BillSplitInput {
  const { a, b } = fx!;
  return {
    restaurantId: fx!.restaurantId,
    lines: [{ menuItemId: a.id, quantity: 2, unitPrice: a.price }, { menuItemId: b.id, quantity: 1, unitPrice: b.price }],
    documentDiscount: discount,
    parts: [
      { lines: [{ menuItemId: a.id, quantity: 1, unitPrice: a.price }, { menuItemId: b.id, quantity: 1, unitPrice: b.price }] },
      { lines: [{ menuItemId: a.id, quantity: 1, unitPrice: a.price }] },
    ],
  };
}

/** The split with each part paid in cash for exactly its quoted total. */
async function paid(input: BillSplitInput) {
  const q = await quoteBillSplit(input, { claims: claims() });
  return { input: { ...input, parts: input.parts.map((p, i) => ({ ...p, payments: [{ method: "cash" as const, amount: q.parts[i].total }] })) }, quote: q };
}

test("by item: each part is its own sale with a shared bill_group_id; the discount is spread", async (t) => {
  if (!fx) return t.skip("no local fixture");
  const { input, quote } = await paid(cartSplit(5));
  const { a, b } = fx;
  // Guest 1's lines are (a + b) of (2a + b): their share of the 5.00 discount, rounded down.
  const share1 = Math.floor((500 * (a.price + b.price)) / (2 * a.price + b.price)) / 100;
  eq(quote.parts.map((p) => p.documentDiscount), [share1, Math.round((5 - share1) * 100) / 100]);
  await rolledBack(async (st) => {
    const res = await recordBillSplit(st, input, fx!.userId);
    strictEqual(res.sales.length, 2);
    eq(res.sales.map((s) => s.billPart), [
      { groupId: res.billGroupId, index: 1, count: 2 },
      { groupId: res.billGroupId, index: 2, count: 2 },
    ]);
    eq(res.sales.map((s) => s.transaction.total), quote.parts.map((p) => p.total));
    const rows = await st.tx<{ receipt_number: string; bill_group_id: string; document_discount: string; payment_method: string }[]>`
      select receipt_number, bill_group_id, document_discount::text, payment_method::text
      from public.sales_transactions where bill_group_id = ${res.billGroupId} and restaurant_id = ${fx!.restaurantId}
      order by receipt_number`;
    strictEqual(rows.length, 2);
    strictEqual(new Set(rows.map((r) => r.receipt_number)).size, 2);
    eq(rows.map((r) => Number(r.document_discount)), quote.parts.map((p) => p.documentDiscount));
    eq(rows.map((r) => r.payment_method), ["cash", "cash"]);
  });
});

test("all or nothing: a bad payment on the last part saves no part", async (t) => {
  if (!fx) return t.skip("no local fixture");
  const { input } = await paid(cartSplit());
  const bad = { ...input, parts: input.parts.map((p, i) => (i === 1 ? { ...p, payments: [{ method: "cash" as const, amount: 0.01 }] } : p)) };
  const [{ n: before }] = await moduleSql<{ n: number }[]>`select count(*)::int as n from public.sales_transactions where restaurant_id = ${fx.restaurantId}`;
  const key = `test-bill-split-${randomUUID()}`;
  await rejects(createBillSplit(bad, { claims: claims(), idempotencyKey: key }), (e: unknown) => {
    ok(e instanceof HttpError);
    strictEqual(e.code, "tender_sum_mismatch");
    strictEqual((e.details as { part: number }).part, 2);
    ok(e.message.startsWith("Guest 2:"));
    return true;
  });
  const [{ n: afterN }] = await moduleSql<{ n: number }[]>`select count(*)::int as n from public.sales_transactions where restaurant_id = ${fx.restaurantId}`;
  strictEqual(afterN, before);
  const keys = await moduleSql`select 1 from public.pos_idempotency_keys where idempotency_key = ${key}`;
  strictEqual(keys.length, 0);
});

test("parts that are not the cart are refused before anything is written", async (t) => {
  if (!fx) return t.skip("no local fixture");
  const { input } = await paid(cartSplit());
  const extra = { ...input, parts: [input.parts[0], { ...input.parts[1], lines: [{ ...input.parts[1].lines[0], quantity: 2 }] }] };
  await rejects(createBillSplit(extra, { claims: claims() }), (e: unknown) => e instanceof HttpError && e.code === "parts_not_cart");
});

test("offline replay keeps each part's printed receipt number and the time of sale", async (t) => {
  if (!fx) return t.skip("no local fixture");
  const { input } = await paid(cartSplit());
  const createdAt = new Date(Date.now() - 3600_000).toISOString();
  const tag = randomUUID().slice(0, 8);
  const receiptNumbers = [`OFF-TEST-${tag}-1`, `OFF-TEST-${tag}-2`];
  await rolledBack(async (st) => {
    const res = await recordBillSplit(st, { ...input, offline: { receiptNumbers, createdAt } }, fx!.userId);
    eq(res.sales.map((s) => s.receiptNumber), receiptNumbers);
    const rows = await st.tx<{ receipt_number: string; at: string }[]>`
      select receipt_number, created_at::text as at from public.sales_transactions
      where bill_group_id = ${res.billGroupId} and restaurant_id = ${fx!.restaurantId} order by receipt_number`;
    eq(rows.map((r) => r.receipt_number), receiptNumbers);
    for (const r of rows) strictEqual(new Date(r.at).toISOString(), createdAt);
  });
  // An offline bill needs one receipt number per part.
  await rejects(
    createBillSplit({ ...input, offline: { receiptNumbers: [receiptNumbers[0], receiptNumbers[0]], createdAt } }, { claims: claims() }),
    (e: unknown) => e instanceof HttpError && e.code === "receipt_numbers_mismatch",
  );
});

test("voiding one part leaves its siblings as they were", async (t) => {
  if (!fx) return t.skip("no local fixture");
  const { input } = await paid(cartSplit());
  await rolledBack(async (st) => {
    const res = await recordBillSplit(st, input, fx!.userId);
    const [first, second] = res.sales.map((s) => s.transaction.id);
    await voidSaleTx(st, first, { restaurantId: fx!.restaurantId, reason: "test: guest 1 changed their mind" }, claims());
    const rows = await st.tx<{ id: string; voided: boolean }[]>`
      select id, (voided_at is not null) as voided from public.sales_transactions
      where id in (${first}, ${second}) and restaurant_id = ${fx!.restaurantId}`;
    const byId = new Map(rows.map((r) => [r.id, r.voided]));
    strictEqual(byId.get(first), true);
    strictEqual(byId.get(second), false);
  });
});
