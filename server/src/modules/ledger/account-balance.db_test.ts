/**
 * chart_of_accounts.balance is owned by the ledger (migration 20261126064155) and voids are
 * flag-only (20261126085723). Runs against a real database (npm run test:db); every test runs
 * in one transaction that is rolled back. Skips without a tenant that has an owner/manager and
 * two active accounts.
 */
import { after, before, test } from "node:test";
import { strictEqual, ok, rejects } from "node:assert/strict";
import type postgres from "postgres";
import { closeModuleDb, moduleSql } from "../shared/db.js";

type Fixture = { tenantId: string; userId: string; a: string; b: string };
let fx: Fixture | null = null;

before(async () => {
  const [row] = await moduleSql<{ tenant_id: string; user_id: string; accounts: string[] }[]>`
    select utr.tenant_id, utr.user_id,
           (select array_agg(c.id order by c.account_code)
              from (select id, account_code from public.chart_of_accounts c
                     where c.tenant_id = utr.tenant_id and coalesce(c.is_active, true)
                       and c.account_type = 'asset' order by c.account_code limit 2) c) as accounts
      from public.user_tenant_roles utr
     where utr.role in ('owner', 'manager')
       and (select count(*) from public.chart_of_accounts c
             where c.tenant_id = utr.tenant_id and coalesce(c.is_active, true) and c.account_type = 'asset') >= 2
     limit 1`;
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

const balance = async (tx: postgres.TransactionSql, id: string) =>
  Number((await tx<{ balance: string }[]>`select balance from public.chart_of_accounts where id = ${id}`)[0].balance);

async function line(tx: postgres.TransactionSql, accountId: string, debit: number | null, credit: number | null) {
  const [r] = await tx<{ id: string }[]>`
    insert into public.account_transactions (tenant_id, account_id, transaction_date, debit, credit, description, reference_type, created_by)
    values (${fx!.tenantId}, ${accountId}, current_date, ${debit}, ${credit}, 'balance test', 'adjustment', ${fx!.userId})
    returning id`;
  return r.id;
}

test("insert, void and move keep balance = sum of live lines; deletes are refused", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const a0 = await balance(tx, fx!.a);
    const b0 = await balance(tx, fx!.b);

    const dr = await line(tx, fx!.a, 100, null);
    const cr = await line(tx, fx!.b, null, 100);
    strictEqual(await balance(tx, fx!.a), a0 + 100);
    strictEqual(await balance(tx, fx!.b), b0 - 100);

    // Void by flag: the line stops counting.
    await tx`update public.account_transactions set is_voided = true, voided_at = now(), void_reason = 'test' where id = ${dr}`;
    strictEqual(await balance(tx, fx!.a), a0);

    // Move a live line to another account.
    await tx`update public.account_transactions set account_id = ${fx!.a} where id = ${cr}`;
    strictEqual(await balance(tx, fx!.b), b0);
    strictEqual(await balance(tx, fx!.a), a0 - 100);

    // Hard deletes are refused (prevent_locked_period_modifications); the balance is untouched.
    await tx`savepoint before_delete`;
    await rejects(tx`delete from public.account_transactions where id = ${cr}`, /cannot be deleted/);
    await tx`rollback to savepoint before_delete`;
    strictEqual(await balance(tx, fx!.a), a0 - 100);
  });
});

test("writes to balance outside the ledger are ignored; new accounts start at 0", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const a0 = await balance(tx, fx!.a);
    await tx`update public.chart_of_accounts set balance = balance + 999 where id = ${fx!.a}`;
    strictEqual(await balance(tx, fx!.a), a0);

    const [acc] = await tx<{ balance: string }[]>`
      insert into public.chart_of_accounts (tenant_id, account_code, account_name, account_type, balance)
      values (${fx!.tenantId}, '1987', 'Balance test account', 'asset', 500)
      returning balance`;
    strictEqual(Number(acc.balance), 0);
  });
});

test("void_transaction voids by flag only: no reversal line, balance moves once", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const a0 = await balance(tx, fx!.a);
    const id = await line(tx, fx!.a, 250, null);
    strictEqual(await balance(tx, fx!.a), a0 + 250);

    const [{ void_transaction: ret }] = await tx<{ void_transaction: string }[]>`select public.void_transaction(${id}, 'entered twice')`;
    strictEqual(ret, id);
    strictEqual(await balance(tx, fx!.a), a0);

    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.account_transactions where original_transaction_id = ${id}`;
    strictEqual(n, 0);
    const [v] = await tx<{ is_voided: boolean; void_reason: string }[]>`select is_voided, void_reason from public.account_transactions where id = ${id}`;
    ok(v.is_voided);
    strictEqual(v.void_reason, "entered twice");
  });
});

test("recompute_account_balances corrects drift and logs it", async (t) => {
  if (!fx) return t.skip("no local fixture");
  await rolledBack(async (tx) => {
    const a0 = await balance(tx, fx!.a);
    // Simulate drift the way the old code produced it: a write that bypasses the ledger.
    await tx`select set_config('matbex.ledger_balance_sync', 'on', true)`;
    await tx`update public.chart_of_accounts set balance = balance + 42 where id = ${fx!.a}`;
    await tx`select set_config('matbex.ledger_balance_sync', 'off', true)`;
    strictEqual(await balance(tx, fx!.a), a0 + 42);

    const rows = await tx<{ tenant_id: string; accounts_corrected: number; abs_drift: string }[]>`
      select * from public.recompute_account_balances(${fx!.tenantId}, 'db_test')`;
    strictEqual(rows.length, 1);
    strictEqual(rows[0].accounts_corrected, 1);
    strictEqual(Number(rows[0].abs_drift), 42);
    strictEqual(await balance(tx, fx!.a), a0);

    const [log] = await tx<{ old_balance: string; new_balance: string }[]>`
      select old_balance, new_balance from public.account_balance_recompute_log
       where account_id = ${fx!.a} and source = 'db_test'`;
    strictEqual(Number(log.old_balance) - Number(log.new_balance), 42);
  });
});

test("browsers cannot run the recompute", async (t) => {
  if (!fx) return t.skip("no local fixture");
  const [{ allowed }] = await moduleSql<{ allowed: boolean }[]>`
    select has_function_privilege('authenticated', 'public.recompute_account_balances(uuid, text)', 'execute') as allowed`;
  strictEqual(allowed, false);
});
