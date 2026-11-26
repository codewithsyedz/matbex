/**
 * Manual journal entries against a real database (npm run test:db). Each test runs the service
 * inside one transaction that is rolled back (withTestTransaction turns the service's
 * transactions into savepoints). Skips without a restaurant whose tenant has an owner and two
 * active asset accounts.
 */
import { after, before, test } from "node:test";
import { ok, rejects, strictEqual } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { HttpError } from "../../lib/errors.js";
import { closeModuleDb, moduleSql, withTestTransaction } from "../shared/db.js";
import { createJournalEntry, reverseJournalEntry, voidJournalEntry } from "./ledger.service.js";

type Fixture = { restaurantId: string; tenantId: string; ownerId: string; a: string; b: string };
let fx: Fixture | null = null;
const as = (sub: string) => ({ sub, role: "authenticated" as const });
const code = (c: string) => (e: unknown) => e instanceof HttpError && e.code === c;

before(async () => {
  const [row] = await moduleSql<{ restaurant_id: string; tenant_id: string; user_id: string; accounts: string[] }[]>`
    select r.id as restaurant_id, r.tenant_id, utr.user_id,
           (select array_agg(c.id order by c.account_code)
              from (select id, account_code from public.chart_of_accounts c
                     where c.tenant_id = r.tenant_id and coalesce(c.is_active, true) and c.account_type = 'asset'
                     order by c.account_code limit 2) c) as accounts
      from public.user_tenant_roles utr
      join public.restaurants r on r.tenant_id = utr.tenant_id
     where utr.role = 'owner'
     limit 1`;
  if (row?.accounts?.length === 2) {
    fx = { restaurantId: row.restaurant_id, tenantId: row.tenant_id, ownerId: row.user_id, a: row.accounts[0], b: row.accounts[1] };
  }
});
after(() => closeModuleDb());

const ROLLBACK = new Error("rollback");
async function rolledBack(fn: (tx: postgres.TransactionSql) => Promise<void>) {
  await moduleSql
    .begin((tx) => withTestTransaction(tx, async () => { await fn(tx); throw ROLLBACK; }))
    .catch((e) => { if (e !== ROLLBACK) throw e; });
}

const balance = async (tx: postgres.TransactionSql, id: string) =>
  Number((await tx<{ balance: string }[]>`select balance from public.chart_of_accounts where id = ${id}`)[0].balance);
const today = async (tx: postgres.TransactionSql) =>
  (await tx<{ d: string }[]>`select ((now() at time zone 'Asia/Riyadh')::date)::text as d`)[0].d;

/** A throwaway user in this business with one role (rolled back with the test). */
async function userWithRole(tx: postgres.TransactionSql, role: "accountant" | "cashier") {
  const [u] = await tx<{ id: string }[]>`insert into auth.users (email) values (${`ledger-test-${randomUUID()}@matbex.test`}) returning id`;
  await tx`insert into public.profiles (id, tenant_id) values (${u.id}, ${fx!.tenantId})
           on conflict (id) do update set tenant_id = excluded.tenant_id`;
  // Accountants hold the role on the restaurant and on the tenant (as on staging); cashiers on the restaurant only.
  await tx`insert into public.user_roles (user_id, restaurant_id, role) values (${u.id}, ${fx!.restaurantId}, ${role})`;
  if (role === "accountant") {
    await tx`insert into public.user_tenant_roles (user_id, tenant_id, role) values (${u.id}, ${fx!.tenantId}, 'accountant')`;
  }
  return u.id;
}

const entry = (date: string, amount = 120) => ({
  restaurantId: fx!.restaurantId,
  date,
  description: "Ledger test: move cash",
  lines: [{ accountId: fx!.a, debit: amount }, { accountId: fx!.b, credit: amount }],
});

test("owner posts a balanced entry; balances move", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const [a0, b0] = [await balance(tx, fx!.a), await balance(tx, fx!.b)];
    const r = await createJournalEntry(entry(await today(tx)), as(fx!.ownerId));
    strictEqual(r.status, "posted");
    strictEqual(r.lineCount, 2);
    strictEqual(await balance(tx, fx!.a), a0 + 120);
    strictEqual(await balance(tx, fx!.b), b0 - 120);
    const [batch] = await tx<{ approval_status: string; is_posted: boolean }[]>`
      select approval_status, is_posted from public.journal_entry_batches where id = ${r.id}`;
    strictEqual(batch.approval_status, "approved");
    ok(batch.is_posted);
  });
});

test("invalid entries are refused before anything is written", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const d = await today(tx);
    await rejects(createJournalEntry({ ...entry(d), lines: [{ accountId: fx!.a, debit: 100 }, { accountId: fx!.b, credit: 99.99 }] }, as(fx!.ownerId)), code("unbalanced"));
    await rejects(createJournalEntry({ ...entry(d), lines: [{ accountId: fx!.a, debit: 5, credit: 5 }, { accountId: fx!.b, credit: 0 }] }, as(fx!.ownerId)), code("line_both_sides"));
    await rejects(createJournalEntry({ ...entry(d), lines: [{ accountId: fx!.a, debit: 5 }, { accountId: randomUUID(), credit: 5 }] }, as(fx!.ownerId)), code("account_invalid"));
  });
});

test("void flags every line; a second void or a reverse is refused", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const a0 = await balance(tx, fx!.a);
    const r = await createJournalEntry(entry(await today(tx)), as(fx!.ownerId));
    const v = await voidJournalEntry(r.id, { restaurantId: fx!.restaurantId, reason: "entered twice" }, as(fx!.ownerId));
    strictEqual(v.status, "voided");
    strictEqual(await balance(tx, fx!.a), a0);
    const lines = await tx<{ is_voided: boolean; void_reason: string }[]>`
      select is_voided, void_reason from public.account_transactions where batch_id = ${r.id}`;
    strictEqual(lines.length, 2);
    ok(lines.every((l) => l.is_voided && l.void_reason === "entered twice"));
    await rejects(voidJournalEntry(r.id, { restaurantId: fx!.restaurantId, reason: "again" }, as(fx!.ownerId)), code("already_voided"));
    await rejects(reverseJournalEntry(r.id, { restaurantId: fx!.restaurantId, reason: "again" }, as(fx!.ownerId)), code("already_voided"));
  });
});

test("reverse posts a linked mirror entry; it cannot be reversed or voided twice", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const [a0, b0] = [await balance(tx, fx!.a), await balance(tx, fx!.b)];
    const r = await createJournalEntry(entry(await today(tx)), as(fx!.ownerId));
    const rev = await reverseJournalEntry(r.id, { restaurantId: fx!.restaurantId, reason: "wrong account" }, as(fx!.ownerId));
    strictEqual(rev.reversalOf, r.id);
    strictEqual(await balance(tx, fx!.a), a0);
    strictEqual(await balance(tx, fx!.b), b0);
    const rows = await tx<{ reference_type: string; reference_id: string; original_transaction_id: string | null }[]>`
      select reference_type, reference_id, original_transaction_id from public.account_transactions where batch_id = ${rev.id}`;
    strictEqual(rows.length, 2);
    ok(rows.every((l) => l.reference_type === "journal_entry_reversal" && l.reference_id === r.id && l.original_transaction_id));
    await rejects(reverseJournalEntry(r.id, { restaurantId: fx!.restaurantId, reason: "again" }, as(fx!.ownerId)), code("already_reversed"));
    await rejects(voidJournalEntry(r.id, { restaurantId: fx!.restaurantId, reason: "again" }, as(fx!.ownerId)), code("already_reversed"));
  });
});

test("locked period: no posting or void there, but a reversal in an open period works", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const r = await createJournalEntry(entry("2020-01-15"), as(fx!.ownerId));
    await tx`insert into public.fiscal_period_locks (tenant_id, restaurant_id, period_start, period_end, locked_by, is_locked)
             values (${fx!.tenantId}, ${fx!.restaurantId}, '2020-01-01', '2020-01-31', ${fx!.ownerId}, true)`;
    await rejects(createJournalEntry(entry("2020-01-20"), as(fx!.ownerId)), code("period_locked"));
    await rejects(voidJournalEntry(r.id, { restaurantId: fx!.restaurantId, reason: "too late" }, as(fx!.ownerId)), code("period_locked"));
    await rejects(reverseJournalEntry(r.id, { restaurantId: fx!.restaurantId, reason: "x", date: "2020-01-25" }, as(fx!.ownerId)), code("period_locked"));
    const rev = await reverseJournalEntry(r.id, { restaurantId: fx!.restaurantId, reason: "fix in current month" }, as(fx!.ownerId));
    strictEqual(rev.date, await today(tx));
  });
});

test("roles: a cashier cannot post; an accountant can't void; an accountant's entry waits for approval when allowed", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const d = await today(tx);
    const cashier = await userWithRole(tx, "cashier");
    await rejects(createJournalEntry(entry(d), as(cashier)), code("role_forbidden"));

    const accountant = await userWithRole(tx, "accountant");
    // Off by default for the business: the database refuses the submission.
    await rejects(createJournalEntry(entry(d), as(accountant)), code("role_forbidden"));

    await tx`update public.tenants set accountant_can_post_journals = true where id = ${fx!.tenantId}`;
    const a0 = await balance(tx, fx!.a);
    const pending = await createJournalEntry(entry(d), as(accountant));
    strictEqual(pending.status, "pending");
    strictEqual(await balance(tx, fx!.a), a0);

    const posted = await createJournalEntry(entry(d), as(fx!.ownerId));
    await rejects(voidJournalEntry(posted.id, { restaurantId: fx!.restaurantId, reason: "no" }, as(accountant)), code("role_forbidden"));
  });
});
