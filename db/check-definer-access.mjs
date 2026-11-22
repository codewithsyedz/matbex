#!/usr/bin/env node
/**
 * Caller-check audit for SECURITY DEFINER functions (CI runs it on the fresh database built by
 * db/migrate.mjs, after check-rls.mjs). Two parts:
 *
 * 1. Static: fails when a definer function a signed-in user can execute contains one of the
 *    patterns behind the 2026-11-22 findings (see docs/self-hosting/FUNCTION_ACCESS_REVIEW.md):
 *      - 2-argument has_role(auth.uid(), 'role'): true for a role held in ANY restaurant;
 *      - can_access_restaurant(<x>.tenant_id): a business id passed where a restaurant id belongs;
 *      - "<> get_user_tenant_id(...)" / "get_user_tenant_id(...) <>": passes (NULL) for callers
 *        without a profile business.
 * 2. Behaviour: inside one transaction that is rolled back, creates two businesses and checks that
 *    the owner of one cannot reach the other's rows through the functions that were open, and that
 *    owners can still act on their own.
 *
 *   DATABASE_URL=postgres://... node db/check-definer-access.mjs
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const failures = [];

// ---------------------------------------------------------------------------------------------
// 1. Static patterns
// ---------------------------------------------------------------------------------------------
const PATTERNS = [
  [/has_role\(\s*(auth\.uid\(\)|v_actor|v_uid|_uid)\s*,\s*'[a-z_]+'(::(public\.)?app_role)?\s*\)/i, "has_role(user, role) checks a role in ANY restaurant; use has_role_in_tenant or 3-argument has_role"],
  [/can_access_restaurant\(\s*[a-z_]+\.tenant_id\s*\)/i, "can_access_restaurant() given a business id"],
  [/<>\s*(public\.)?get_user_tenant_id\(|get_user_tenant_id\([^)]*\)\s*<>/i, "'<> get_user_tenant_id()' passes when the caller has no profile business; use IS DISTINCT FROM or user_belongs_to_tenant"],
];
// Reviewed exceptions: "function name": reason.
const ALLOWED = {
  amend_posted_expense: "its global has_role is redundant: assert_expense_correction_access(p_expense_id) checks a restaurant-scoped role before any write",
};

const fns = await sql`
  select p.oid::regprocedure::text as sig, p.proname as name, p.prosrc as src
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')`;
for (const f of fns) {
  if (ALLOWED[f.name]) continue;
  const src = f.src.replace(/--[^\n]*/g, "");
  for (const [re, why] of PATTERNS) if (re.test(src)) failures.push(`${f.sig}: ${why}`);
}

// ---------------------------------------------------------------------------------------------
// 2. Behaviour
// ---------------------------------------------------------------------------------------------
const id = () => crypto.randomUUID();
const A = { user: id(), tenant: id(), restaurant: id() };
const B = { user: id(), tenant: id(), restaurant: id() };
const C = { user: id() }; // signed up, no business yet
const fx = { accountA: id(), accountB: id(), expenseA: id(), staffA: id(), advanceA: id(), itemA: id(), movementA: id(), orderA: id() };

class Rollback extends Error {}

/** Runs `fn` as the given user inside a savepoint that is always rolled back. Returns the error code or "ok". */
async function as(tx, user, fn) {
  try {
    await tx.savepoint(async (sp) => {
      await sp.unsafe("set local role authenticated");
      await sp`select set_config('request.jwt.claim.sub', ${user}, true)`;
      await fn(sp);
      throw new Rollback();
    });
  } catch (e) {
    if (e instanceof Rollback) return "ok";
    // Refusals: 42501, or a function's own forbidden message (some keep their original raise).
    if (e.code === "42501" || /forbid|not authori[sz]ed|not allowed|insufficient privileges/i.test(e.message)) return "denied";
    return `${e.code}: ${e.message}`;
  }
}
const expect = (label, got, want) => {
  const ok = Array.isArray(want) ? want.includes(got) : got === want;
  if (!ok) failures.push(`${label}: expected ${want}, got ${got}`);
};
const denied = "denied";

try {
  await sql.begin(async (tx) => {
    await tx`insert into auth.users (id, email) values (${A.user}, 'definer-a@check.test'), (${B.user}, 'definer-b@check.test'), (${C.user}, 'definer-c@check.test')`;
    await tx`insert into public.tenants (id, name, slug) values (${A.tenant}, 'Definer A', ${"definer-a-" + A.tenant.slice(0, 8)}), (${B.tenant}, 'Definer B', ${"definer-b-" + B.tenant.slice(0, 8)})`;
    await tx`insert into public.restaurants (id, name, tenant_id) values (${A.restaurant}, 'Rest A', ${A.tenant}), (${B.restaurant}, 'Rest B', ${B.tenant})`;
    for (const x of [A, B]) {
      await tx`insert into public.user_roles (user_id, restaurant_id, role) values (${x.user}, ${x.restaurant}, 'owner')`;
      await tx`insert into public.user_tenant_roles (user_id, tenant_id, role) values (${x.user}, ${x.tenant}, 'owner') on conflict do nothing`;
      await tx`insert into public.profiles (id, tenant_id) values (${x.user}, ${x.tenant}) on conflict (id) do update set tenant_id = excluded.tenant_id`;
    }
    await tx`insert into public.chart_of_accounts (id, tenant_id, account_type, account_code, account_name) values
      (${fx.accountA}, ${A.tenant}, 'expense', '6991', 'Check A'), (${fx.accountB}, ${B.tenant}, 'expense', '6991', 'Check B')`;
    await tx`insert into public.expenses (id, restaurant_id, tenant_id, amount, created_by) values (${fx.expenseA}, ${A.restaurant}, ${A.tenant}, 10, ${A.user})`;
    await tx`insert into public.staff (id, restaurant_id, name, role) values (${fx.staffA}, ${A.restaurant}, 'Staff A', 'cashier')`;
    await tx`insert into public.staff_advances (id, tenant_id, restaurant_id, staff_id, amount, created_by) values (${fx.advanceA}, ${A.tenant}, ${A.restaurant}, ${fx.staffA}, 50, ${A.user})`;
    await tx`insert into public.inventory_items (id, restaurant_id, name) values (${fx.itemA}, ${A.restaurant}, 'Item A')`;
    await tx`insert into public.stock_movements (id, restaurant_id, tenant_id, inventory_item_id, quantity_change, stock_before, stock_after, movement_type)
      values (${fx.movementA}, ${A.restaurant}, ${A.tenant}, ${fx.itemA}, 1, 0, 1, 'adjustment')`;
    await tx`insert into public.online_orders (id, restaurant_id, order_number, order_type, customer_name, customer_phone) values (${fx.orderA}, ${A.restaurant}, 1, 'delivery', 'C', '0500000000')`;

    // Structural: a ledger line cannot use another business's account (any caller).
    try {
      await tx.savepoint((sp) => sp`insert into public.account_transactions (tenant_id, account_id, debit, credit, description) values (${B.tenant}, ${fx.accountA}, 1, 0, 'check')`);
      failures.push("ledger line with another business's account was accepted");
    } catch (e) {
      expect("ledger line with another business's account", e.code, "42501");
    }

    // Structural: browsers cannot choose a restaurant id.
    await as(tx, B.user, async (sp) => {
      const [r] = await sp`insert into public.restaurants (id, name, tenant_id) values (${A.tenant}, 'Spoof', ${B.tenant}) returning id`;
      if (r.id === A.tenant) failures.push("browser-chosen restaurant id was kept");
    });

    // Structural: audit rows only for your own business.
    expect("audit_logs insert for another business",
      await as(tx, B.user, (sp) => sp`insert into public.audit_logs (user_id, tenant_id, action, entity_type) values (${B.user}, ${A.tenant}, 'X', 'x')`), denied);

    // Revoked from signed-in users.
    expect("post_daily_sales_to_ledger is not callable", await as(tx, B.user, (sp) => sp`select public.post_daily_sales_to_ledger(${id()})`), denied);

    // Owner of B against A's rows.
    const cross = [
      ["lock_fiscal_period", (sp) => sp`select public.lock_fiscal_period(${A.restaurant}, '2020-01-01', '2020-01-31')`],
      ["post_expense_to_ledger", (sp) => sp`select public.post_expense_to_ledger(${fx.expenseA}, null)`],
      ["reconcile_expense_ledger(all)", (sp) => sp`select public.reconcile_expense_ledger(null)`],
      ["reconcile_expense_ledger(A)", (sp) => sp`select public.reconcile_expense_ledger(${A.tenant})`],
      ["undo_stock_adjustment", (sp) => sp`select public.undo_stock_adjustment(${fx.movementA})`],
      ["reverse_staff_advance_atomic", (sp) => sp`select public.reverse_staff_advance_atomic(${fx.advanceA}, 'x', 'delete')`],
      ["log_audit", (sp) => sp`select public.log_audit('X', 'x', null, null, null, ${A.tenant})`],
      ["auto_assign_rider", (sp) => sp`select public.auto_assign_rider(${fx.orderA})`],
      ["explain_imbalance", (sp) => sp`select public.explain_imbalance(${fx.expenseA})`],
      ["submit_pending_journal_entry", (sp) => sp`select public.submit_pending_journal_entry('x', 'manual', 'general', current_date, 'CHK',
          ${sp.json([{ account_id: fx.accountA, debit: 1, credit: 0 }, { account_id: fx.accountB, debit: 0, credit: 1 }])}, null)`],
    ];
    for (const [label, fn] of cross) expect(`${label} (other business)`, await as(tx, B.user, fn), denied);

    // Brand-new account with no business (the NULL profile-tenant bypass).
    expect("explain_imbalance (no business)", await as(tx, C.user, (sp) => sp`select public.explain_imbalance(${fx.expenseA})`), denied);
    expect("inspect_zatca_audit_break (no business)", await as(tx, C.user, (sp) => sp`select public.inspect_zatca_audit_break(${A.tenant})`), denied);

    // Input rules.
    expect("increment_usage negative", (await as(tx, B.user, (sp) => sp`select public.increment_usage(${B.tenant}, 'ai_images', -5)`)).slice(0, 5), "22023");

    // Owners still act on their own business.
    expect("log_audit (own business)", await as(tx, A.user, (sp) => sp`select public.log_audit('X', 'x', null, null, null, ${A.tenant})`), "ok");
    expect("auto_assign_rider (own order)", await as(tx, A.user, (sp) => sp`select public.auto_assign_rider(${fx.orderA})`), "ok");
    expect("lock_fiscal_period (own)", await as(tx, A.user, (sp) => sp`select public.lock_fiscal_period(${A.restaurant}, '2020-01-01', '2020-01-31')`), "ok");
    expect("undo_stock_adjustment (own)", await as(tx, A.user, (sp) => sp`select public.undo_stock_adjustment(${fx.movementA})`), "ok");
    expect("audit_logs insert (own business)",
      await as(tx, A.user, (sp) => sp`insert into public.audit_logs (user_id, tenant_id, action, entity_type) values (${A.user}, ${A.tenant}, 'X', 'x')`), "ok");

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) failures.push(`setup failed: ${e.message}`);
}

await sql.end();
if (failures.length) {
  console.error(`Definer caller-check audit failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Definer caller-check audit passed (${fns.length} functions scanned).`);
