/**
 * Journal entry headers, numbering and the integrity checks (migration 20261126121749) against
 * a real database (npm run test:db). Every test runs in one rolled-back transaction; the
 * deferred balance check is fired with SET CONSTRAINTS ... IMMEDIATE because nothing commits.
 */
import { after, before, test } from "node:test";
import { ok, rejects, strictEqual, notStrictEqual } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { closeModuleDb, moduleSql } from "../shared/db.js";

type Fixture = { tenantId: string; userId: string; a: string; b: string };
let fx: Fixture | null = null;

before(async () => {
  const [row] = await moduleSql<{ tenant_id: string; user_id: string; accounts: string[] }[]>`
    select utr.tenant_id, utr.user_id,
           (select array_agg(c.id order by c.account_code)
              from (select id, account_code from public.chart_of_accounts c
                     where c.tenant_id = utr.tenant_id and coalesce(c.is_active, true) and c.account_type = 'asset'
                     order by c.account_code limit 2) c) as accounts
      from public.user_tenant_roles utr where utr.role = 'owner' limit 1`;
  if (row?.accounts?.length === 2) fx = { tenantId: row.tenant_id, userId: row.user_id, a: row.accounts[0], b: row.accounts[1] };
});
after(() => closeModuleDb());

const ROLLBACK = new Error("rollback");
async function rolledBack(fn: (tx: postgres.TransactionSql) => Promise<void>) {
  await moduleSql
    .begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${fx!.userId}, true)`;
      await fn(tx);
      throw ROLLBACK;
    })
    .catch((e) => { if (e !== ROLLBACK) throw e; });
}

async function line(tx: postgres.TransactionSql, ref: string | null, accountId: string, debit: number | null, credit: number | null, batchId: string | null = null) {
  const [r] = await tx<{ id: string; entry_id: string }[]>`
    insert into public.account_transactions (tenant_id, account_id, transaction_date, debit, credit, description, reference_type, reference_id, batch_id, created_by)
    values (${fx!.tenantId}, ${accountId}, current_date, ${debit}, ${credit}, 'integrity test', 'adjustment', ${ref}, ${batchId}, ${fx!.userId})
    returning id, entry_id`;
  return r;
}
const violations = async (tx: postgres.TransactionSql, kind: string) =>
  (await tx<{ n: number }[]>`select count(*)::int as n from public.ledger_integrity_violations where kind = ${kind} and txid = txid_current()`)[0].n;
const fireBalanceCheck = (tx: postgres.TransactionSql) => tx`set constraints public.zz_check_journal_entry_balance immediate`;
const setMode = (tx: postgres.TransactionSql, balance: boolean, appendOnly: boolean) =>
  tx`update public.ledger_integrity_settings set enforce_balance = ${balance}, enforce_append_only = ${appendOnly} where id`;

test("lines of one posting share a header; another posting gets its own", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const ref1 = randomUUID();
    const ref2 = randomUUID();
    const l1 = await line(tx, ref1, fx!.a, 50, null);
    const l2 = await line(tx, ref1, fx!.b, null, 50);
    const l3 = await line(tx, ref2, fx!.a, 5, null);
    ok(l1.entry_id);
    strictEqual(l1.entry_id, l2.entry_id);
    notStrictEqual(l1.entry_id, l3.entry_id);
    const [h] = await tx<{ source_type: string; source_key: string; entry_number: string | null }[]>`
      select source_type, source_key, entry_number from public.journal_entries where id = ${l1.entry_id}`;
    strictEqual(h.source_type, "adjustment");
    strictEqual(h.source_key, ref1);
    strictEqual(h.entry_number, null);
  });
});

test("number_journal_entries numbers new entries gap-free after the last number", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    await tx`select public.number_journal_entries(${fx!.tenantId})`;
    const [{ last }] = await tx<{ last: string }[]>`
      select coalesce(max(entry_number), 0)::text as last from public.journal_entries where tenant_id = ${fx!.tenantId}`;
    const e1 = (await line(tx, randomUUID(), fx!.a, 1, null)).entry_id;
    const e2 = (await line(tx, randomUUID(), fx!.a, 1, null)).entry_id;
    const [{ n }] = await tx<{ n: number }[]>`select public.number_journal_entries(${fx!.tenantId}) as n`;
    strictEqual(n, 2);
    const rows = await tx<{ id: string; entry_number: string }[]>`
      select id, entry_number::text from public.journal_entries where id in (${e1}, ${e2}) order by entry_number`;
    strictEqual(rows[0].id, e1);
    strictEqual(Number(rows[0].entry_number), Number(last) + 1);
    strictEqual(Number(rows[1].entry_number), Number(last) + 2);
  });
});

test("log mode: an unbalanced entry is recorded at commit, a balanced one is not", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    await setMode(tx, false, false);
    const ok1 = randomUUID();
    await line(tx, ok1, fx!.a, 30, null);
    await line(tx, ok1, fx!.b, null, 30);
    const bad = await line(tx, randomUUID(), fx!.a, 30, null);
    await fireBalanceCheck(tx);
    strictEqual(await violations(tx, "unbalanced"), 1);
    const [v] = await tx<{ entry_id: string }[]>`
      select entry_id from public.ledger_integrity_violations where kind = 'unbalanced' and txid = txid_current()`;
    strictEqual(v.entry_id, bad.entry_id);
  });
});

test("enforce mode: an unbalanced entry fails the transaction", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    await setMode(tx, true, false);
    await line(tx, randomUUID(), fx!.a, 30, null);
    await tx`savepoint s`;
    await rejects(fireBalanceCheck(tx), /LEDGER_UNBALANCED/);
    await tx`rollback to savepoint s`;
  });
});

test("edits: voiding and linking a NULL reference are allowed; changing an amount is logged, or refused when enforced", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    await setMode(tx, false, false);
    const [{ id: batch }] = await tx<{ id: string }[]>`
      insert into public.journal_entry_batches (tenant_id, description, created_by) values (${fx!.tenantId}, 'integrity test', ${fx!.userId}) returning id`;
    const a = await line(tx, null, fx!.a, 10, null, batch);
    const b = await line(tx, null, fx!.b, null, 10, batch);
    const ref = randomUUID();
    await tx`update public.account_transactions set reference_id = ${ref} where id in (${a.id}, ${b.id})`;
    await tx`update public.account_transactions set is_voided = true, void_reason = 'test' where id in (${a.id}, ${b.id})`;
    strictEqual(await violations(tx, "line_update"), 0);

    const c = await line(tx, randomUUID(), fx!.a, 10, null);
    await tx`update public.account_transactions set debit = 11 where id = ${c.id}`;
    strictEqual(await violations(tx, "line_update"), 1);
    await tx`update public.account_transactions set is_voided = true where id = ${c.id}`;
    await tx`update public.account_transactions set is_voided = false where id = ${c.id}`;
    strictEqual(await violations(tx, "unvoid"), 1);

    await setMode(tx, false, true);
    await tx`savepoint s`;
    await rejects(tx`update public.account_transactions set description = 'changed' where id = ${c.id}`, /LEDGER_APPEND_ONLY/);
    await tx`rollback to savepoint s`;
  });
});
