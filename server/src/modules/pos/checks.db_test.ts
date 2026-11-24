/**
 * Open checks against a real database (npm run test:db). Each test runs the services inside
 * one transaction it rolls back (withTestTransaction turns their transactions into
 * savepoints), so nothing is left behind. Skips without a restaurant that has an owner and
 * two priced, active menu items.
 */
import { after, before, test } from "node:test";
import { deepStrictEqual as eq, ok, rejects, strictEqual } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { HttpError } from "../../lib/errors.js";
import { closeModuleDb, moduleSql, withTestTransaction } from "../shared/db.js";
import { addLines, editLine, getCheck, listOpenChecks, openCheck, payCheck, sendCheck, voidCheck, voidLine } from "./checks.service.js";

type Fixture = { restaurantId: string; tenantId: string; userId: string; a: { id: string; price: number }; b: { id: string; price: number } };
let fx: Fixture | null = null;
const claims = () => ({ sub: fx!.userId, role: "authenticated" as const });
const code = (c: string) => (e: unknown) => e instanceof HttpError && e.code === c;

before(async () => {
  const [row] = await moduleSql<{ restaurant_id: string; tenant_id: string; user_id: string; items: { id: string; price: number }[] }[]>`
    select ur.restaurant_id, r.tenant_id, ur.user_id,
           (select json_agg(json_build_object('id', m.id, 'price', m.selling_price::float8) order by m.selling_price)
              from (select * from public.menu_items m where m.restaurant_id = ur.restaurant_id and coalesce(m.is_active, true)
                      and m.selling_price > 0 limit 2) m) as items
    from public.user_roles ur join public.restaurants r on r.id = ur.restaurant_id
    where ur.role = 'owner'
      and (select count(*) from public.menu_items m where m.restaurant_id = ur.restaurant_id and coalesce(m.is_active, true) and m.selling_price > 0) >= 2
    limit 1`;
  if (row?.items?.length === 2) fx = { restaurantId: row.restaurant_id, tenantId: row.tenant_id, userId: row.user_id, a: row.items[0], b: row.items[1] };
});
after(() => closeModuleDb());

const ROLLBACK = new Error("rollback");
async function rolledBack(fn: (tx: postgres.TransactionSql) => Promise<void>) {
  await moduleSql
    .begin((tx) => withTestTransaction(tx, async () => { await fn(tx); throw ROLLBACK; }))
    .catch((e) => { if (e !== ROLLBACK) throw e; });
}

async function newTable(tx: postgres.TransactionSql, label = `T-${randomUUID().slice(0, 4)}`) {
  const [t] = await tx<{ id: string }[]>`
    insert into public.pos_tables (tenant_id, restaurant_id, label, code, capacity, status)
    values (${fx!.tenantId}, ${fx!.restaurantId}, ${label}, ${label}, 4, 'free') returning id`;
  return t.id;
}
const tableStatus = async (tx: postgres.TransactionSql, id: string) =>
  (await tx<{ status: string }[]>`select status from public.pos_tables where id = ${id}`)[0].status;
const line = (item: { id: string; price: number }, quantity = 1) => ({ menuItemId: item.id, quantity, unitPrice: item.price });

test("open on a table, send: table seated then ordered, one kitchen ticket per round", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const tableId = await newTable(tx);
    const c = await openCheck({ restaurantId: fx!.restaurantId, tableId, guestCount: 2, lines: [line(fx!.a, 2)] }, claims());
    ok(/^CHK-\d{8}-\d{3}$/.test(c.checkNumber));
    eq([c.itemCount, c.unsentCount, c.rounds.length], [2, 2, 0]);
    strictEqual(await tableStatus(tx, tableId), "seated");

    const sent = await sendCheck(c.id, { restaurantId: fx!.restaurantId, expectedVersion: c.version }, claims());
    eq([sent.unsentCount, sent.rounds.length, sent.lines[0].roundNumber], [0, 1, 1]);
    strictEqual(await tableStatus(tx, tableId), "ordered");
    const items = await tx<{ quantity: number; source: string }[]>`
      select i.quantity::int as quantity, k.source from public.pos_kds_ticket_items i join public.pos_kds_tickets k on k.id = i.ticket_id
      where k.id = ${sent.rounds[0].kdsTicketId}`;
    eq([...items], [{ quantity: 2, source: "check" }]);
    await rejects(sendCheck(c.id, { restaurantId: fx!.restaurantId }, claims()), code("nothing_to_send"));

    // A second check on the same table is refused; the list shows the open one.
    await rejects(openCheck({ restaurantId: fx!.restaurantId, tableId }, claims()), code("table_has_open_check"));
    ok((await listOpenChecks({ restaurantId: fx!.restaurantId }, claims())).some((x) => x.id === c.id && x.itemCount === 2));
  });
});

test("unsent lines can change, sent ones can't; stale versions and prices are refused", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async () => {
    const r = fx!.restaurantId;
    let c = await openCheck({ restaurantId: r, name: "Bar tab", lines: [line(fx!.a)], send: true }, claims());
    c = await addLines(c.id, { restaurantId: r, expectedVersion: c.version, lines: [line(fx!.b, 3)] }, claims());
    const unsent = c.lines.find((l) => l.roundNumber == null)!;
    const sentLine = c.lines.find((l) => l.roundNumber === 1)!;
    c = await editLine(c.id, unsent.id, { restaurantId: r, expectedVersion: c.version, quantity: 1, note: "no onions" }, claims());
    eq([c.lines.find((l) => l.id === unsent.id)!.quantity, c.lines.find((l) => l.id === unsent.id)!.note], [1, "no onions"]);
    await rejects(editLine(c.id, sentLine.id, { restaurantId: r, quantity: 5 }, claims()), code("line_sent"));
    await rejects(voidLine(c.id, sentLine.id, { restaurantId: r }, claims()), code("line_sent"));
    await rejects(addLines(c.id, { restaurantId: r, expectedVersion: c.version - 1, lines: [line(fx!.a)] }, claims()), code("check_changed"));
    await rejects(addLines(c.id, { restaurantId: r, lines: [{ ...line(fx!.a), unitPrice: fx!.a.price + 1 }] }, claims()), code("price_changed"));
    c = await voidLine(c.id, unsent.id, { restaurantId: r, expectedVersion: c.version, reason: "changed mind" }, claims());
    eq([c.itemCount, c.lines.find((l) => l.id === unsent.id)!.status], [1, "voided"]);
    await rejects(voidCheck(c.id, { restaurantId: r }, claims()), code("check_sent"));
  });
});

test("pay: unsent lines go to the kitchen first, the sale keeps the check's prices and makes no second ticket", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const r = fx!.restaurantId;
    const tableId = await newTable(tx);
    let c = await openCheck({ restaurantId: r, tableId, lines: [line(fx!.a)], send: true }, claims());
    c = await addLines(c.id, { restaurantId: r, lines: [line(fx!.b)] }, claims());
    // The menu price changes during the meal: the guest pays what they ordered at.
    await tx`update public.menu_items set selling_price = selling_price + 5 where id = ${fx!.a.id}`;
    const key = `test-check-pay-${randomUUID()}`;
    const res = await payCheck(c.id, { restaurantId: r, expectedVersion: c.version, payments: [{ method: "cash", amount: c.total }] }, { claims: claims(), idempotencyKey: key });
    strictEqual(res.sales.length, 1);
    strictEqual(res.sales[0].transaction.total, c.total);
    strictEqual(res.check.status, "paid");
    strictEqual(res.check.rounds.length, 2);
    strictEqual(await tableStatus(tx, tableId), "dirty");
    await tx`set constraints all immediate`; // fire the deferred kitchen-ticket trigger now
    const [{ n }] = await tx<{ n: number }[]>`
      select count(*)::int as n from public.pos_kds_tickets where source = 'pos' and source_order_id = ${res.sales[0].transaction.id}`;
    strictEqual(n, 0);
    const [{ check_id }] = await tx<{ check_id: string }[]>`select check_id from public.sales_transactions where id = ${res.sales[0].transaction.id}`;
    strictEqual(check_id, c.id);

    // A retry with the same key returns the first result; a paid check takes nothing more.
    const again = await payCheck(c.id, { restaurantId: r, payments: [{ method: "cash", amount: c.total }] }, { claims: claims(), idempotencyKey: key });
    eq([again.replayed, again.sales[0].transaction.id], [true, res.sales[0].transaction.id]);
    await rejects(addLines(c.id, { restaurantId: r, lines: [line(fx!.a)] }, claims()), code("check_closed"));
  });
});

test("pay by split bill: one sale per guest, each linked to the check", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const r = fx!.restaurantId;
    const c = await openCheck({ restaurantId: r, name: "Two friends", lines: [line(fx!.a), line(fx!.b)], send: true }, claims());
    const parts = [{ lines: [line(fx!.a)] }, { lines: [line(fx!.b)] }];
    const { quoteBillSplit } = await import("./bill-split.service.js");
    const q = await quoteBillSplit({ restaurantId: r, lines: parts.flatMap((p) => p.lines), parts }, { claims: claims() });
    const res = await payCheck(c.id, {
      restaurantId: r,
      parts: parts.map((p, i) => ({ ...p, payments: [{ method: "cash" as const, amount: q.parts[i].total }] })),
    }, { claims: claims() });
    strictEqual(res.sales.length, 2);
    ok(res.billGroupId);
    const rows = await tx<{ check_id: string; bill_group_id: string }[]>`
      select check_id, bill_group_id from public.sales_transactions where check_id = ${c.id}`;
    eq(rows.map((x) => [x.check_id, x.bill_group_id]), [[c.id, res.billGroupId], [c.id, res.billGroupId]]);
    // Parts that are not the check's lines are refused.
    const c2 = await openCheck({ restaurantId: r, name: "Wrong split", lines: [line(fx!.a)] }, claims());
    await rejects(payCheck(c2.id, { restaurantId: r, parts: [{ lines: [line(fx!.a)], payments: [] }, { lines: [line(fx!.b)], payments: [] }] }, { claims: claims() }), code("parts_not_cart"));
  });
});

test("void a check nothing of which was sent: closed, table free", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const r = fx!.restaurantId;
    const tableId = await newTable(tx);
    const c = await openCheck({ restaurantId: r, tableId, lines: [line(fx!.a)] }, claims());
    const v = await voidCheck(c.id, { restaurantId: r, reason: "walked out before ordering" }, claims());
    strictEqual(v.status, "void");
    strictEqual(await tableStatus(tx, tableId), "free");
    strictEqual((await getCheck(c.id, r, claims())).status, "void");
    await rejects(openCheck({ restaurantId: r }, claims()), code("check_needs_table_or_name"));
  });
});
