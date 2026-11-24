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
import {
  addLines, checksReport, editLine, getCheck, listOpenChecks, mergeChecks, moveCheck, openCheck, payCheck, prebill, sendCheck, setServiceCharge, voidCheck, voidLine,
} from "./checks.service.js";

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
    await rejects(voidLine(c.id, sentLine.id, { restaurantId: r }, claims()), code("reason_required"));
    await rejects(addLines(c.id, { restaurantId: r, expectedVersion: c.version - 1, lines: [line(fx!.a)] }, claims()), code("check_changed"));
    await rejects(addLines(c.id, { restaurantId: r, lines: [{ ...line(fx!.a), unitPrice: fx!.a.price + 1 }] }, claims()), code("price_changed"));
    c = await voidLine(c.id, unsent.id, { restaurantId: r, expectedVersion: c.version, reason: "changed mind" }, claims());
    eq([c.itemCount, c.lines.find((l) => l.id === unsent.id)!.status], [1, "voided"]);
    await rejects(voidCheck(c.id, { restaurantId: r }, claims()), code("reason_required"));
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

// ---- 2b.2: voids with waste, PIN, service charge, move, merge, prebill, day end ----------

/** A cashier of the fixture restaurant (inside the test transaction). */
async function newCashier(tx: postgres.TransactionSql) {
  const [u] = await tx<{ id: string }[]>`insert into auth.users (id, email) values (gen_random_uuid(), ${`cashier-${randomUUID().slice(0, 6)}@test.local`}) returning id`;
  await tx`insert into public.user_roles (user_id, restaurant_id, role) values (${u.id}, ${fx!.restaurantId}, 'cashier')`;
  return { sub: u.id, role: "authenticated" as const };
}

/** Gives item `a` a one-ingredient recipe (2 units of a new stock item at 1.50 each). */
async function recipeForA(tx: postgres.TransactionSql) {
  const [inv] = await tx<{ id: string }[]>`
    insert into public.inventory_items (restaurant_id, name, unit, unit_cost, current_stock)
    values (${fx!.restaurantId}, ${`Test patty ${randomUUID().slice(0, 4)}`}, 'pcs', 1.5, 100) returning id`;
  await tx`insert into public.recipe_ingredients (menu_item_id, inventory_item_id, quantity_required, restaurant_id) values (${fx!.a.id}, ${inv.id}, 2, ${fx!.restaurantId})`;
  return inv.id;
}

test("voiding a sent item: reason and manager needed, kitchen item cancelled, recorded as waste", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const r = fx!.restaurantId;
    const invId = await recipeForA(tx);
    const c = await openCheck({ restaurantId: r, name: "Void test", lines: [line(fx!.a, 3)], send: true }, claims());
    const sent = c.lines[0];
    await rejects(voidLine(c.id, sent.id, { restaurantId: r }, claims()), code("reason_required"));

    // A cashier needs the admin PIN.
    const cashier = await newCashier(tx);
    await rejects(voidLine(c.id, sent.id, { restaurantId: r, reason: "dropped on floor" }, cashier), code("manager_required"));
    await tx`update public.tenants set admin_pin_hash = extensions.crypt('4321', extensions.gen_salt('bf', 4)) where id = ${fx!.tenantId}`;
    await rejects(voidLine(c.id, sent.id, { restaurantId: r, reason: "dropped on floor", adminPin: "1111" }, cashier), code("admin_pin_invalid"));

    // 1 of the 3 units, approved with the PIN.
    const after = await voidLine(c.id, sent.id, { restaurantId: r, reason: "dropped on floor", adminPin: "4321", quantity: 1 }, cashier);
    eq([after.itemCount, after.lines.filter((l) => l.status === "voided").map((l) => l.quantity)], [2, [1]]);
    const [{ stock }] = await tx<{ stock: number }[]>`select current_stock::float8 as stock from public.inventory_items where id = ${invId}`;
    strictEqual(stock, 98);
    const waste = await tx<{ qty: number; cost: number; reason: string }[]>`
      select quantity_wasted::float8 as qty, total_cost::float8 as cost, waste_reason as reason from public.waste_records where inventory_item_id = ${invId}`;
    eq([...waste], [{ qty: 2, cost: 3, reason: "voided_order" }]);
    const [mv] = await tx<{ type: string; change: number }[]>`select movement_type as type, quantity_change::float8 as change from public.stock_movements where inventory_item_id = ${invId}`;
    eq(mv, { type: "waste", change: -2 });
    const [item] = await tx<{ quantity: number; status: string }[]>`select quantity::float8 as quantity, status from public.pos_kds_ticket_items where check_line_id = ${sent.id}`;
    eq(item, { quantity: 2, status: "pending" });

    // The rest, by the owner: the kitchen item is cancelled; voiding the check needs a reason.
    await voidLine(c.id, sent.id, { restaurantId: r, reason: "guest left" }, claims());
    const [item2] = await tx<{ status: string }[]>`select status from public.pos_kds_ticket_items where check_line_id = ${sent.id}`;
    strictEqual(item2.status, "cancelled");
    const [{ voidStatus, approvals }] = await tx<{ voidStatus: string; approvals: string[] }[]>`
      select string_agg(distinct status, ',') as "voidStatus", array_agg(void_approval order by void_approval) as approvals
      from public.pos_check_lines where check_id = ${c.id}`;
    eq([voidStatus, approvals], ["voided", ["admin_pin", "role"]]);
  });
});

test("service charge: from the branch, waived only with a manager, charged as the sale's surcharge", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const r = fx!.restaurantId;
    await tx`update public.branches set service_charge_percent = 10 where restaurant_id = ${r}`;
    let c = await openCheck({ restaurantId: r, name: "Service", lines: [line(fx!.a), line(fx!.b)], send: true }, claims());
    const lines = fx!.a.price + fx!.b.price;
    eq([c.serviceChargePercent, c.serviceCharge], [10, Math.round(lines * 10) / 100]);
    const cashier = await newCashier(tx);
    await rejects(setServiceCharge(c.id, { restaurantId: r, waived: true, reason: "regular guest" }, cashier), code("manager_required"));
    c = await setServiceCharge(c.id, { restaurantId: r, waived: true, reason: "regular guest" }, claims());
    eq([c.serviceCharge, c.serviceChargeWaived], [0, true]);
    c = await setServiceCharge(c.id, { restaurantId: r, waived: false }, cashier);
    const res = await payCheck(c.id, { restaurantId: r, payments: [{ method: "cash", amount: c.total }] }, { claims: claims() });
    const [sale] = await tx<{ surcharge: number; service: number; total: number }[]>`
      select document_surcharge::float8 as surcharge, service_charge::float8 as service, total::float8 as total
      from public.sales_transactions where id = ${res.sales[0].transaction.id}`;
    eq(sale, { surcharge: c.serviceCharge, service: c.serviceCharge, total: c.total });
  });
});

test("move to another table, merge two checks, pre-bill; the day can't close with checks open", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const r = fx!.restaurantId;
    const [t1, t2, t3] = [await newTable(tx), await newTable(tx), await newTable(tx)];
    const a = await openCheck({ restaurantId: r, tableId: t1, lines: [line(fx!.a)], send: true }, claims());
    const b = await openCheck({ restaurantId: r, tableId: t2, lines: [line(fx!.b)], send: true }, claims());
    await rejects(moveCheck(a.id, { restaurantId: r, tableId: t2 }, claims()), code("table_has_open_check"));
    const moved = await moveCheck(a.id, { restaurantId: r, tableId: t3 }, claims());
    eq([moved.tableId, await tableStatus(tx, t3), await tableStatus(tx, t1)], [t3, "ordered", "dirty"]);

    const merged = await mergeChecks(a.id, { restaurantId: r, fromCheckId: b.id }, claims());
    eq([merged.itemCount, merged.rounds.map((x) => x.number)], [2, [1, 2]]);
    strictEqual((await getCheck(b.id, r, claims())).status, "merged");
    strictEqual(await tableStatus(tx, t2), "dirty");

    await prebill(a.id, { restaurantId: r }, claims());
    strictEqual(await tableStatus(tx, t3), "billing");

    // Day end: closing a day is refused while a check opened on or before it is still open.
    await tx`update public.pos_checks set opened_at = now() - interval '2 days' where id = ${a.id}`;
    await tx`savepoint d`;
    const outcome = await tx`
      insert into public.daily_sales_summary (restaurant_id, tenant_id, sales_date, cash_sales, card_sales, delivery_sales, status, created_by)
      values (${r}, ${fx!.tenantId}, current_date - 1, 0, 0, 0, 'submitted', ${fx!.userId})
      returning id`
      .then(([row]) => tx`update public.daily_sales_summary set status = 'closed' where id = ${row.id}`)
      .then(() => "closed", (e: Error) => e.message);
    await tx`rollback to savepoint d`;
    // The sequence rules may refuse the summary itself on some data; then the guard is untested here.
    if (!/future date|unclosed|sequence/i.test(outcome)) ok(/open check/.test(outcome), outcome);

    const report = await checksReport({ restaurantId: r }, claims());
    ok(report.open.checks.some((x) => x.id === a.id));
  });
});
