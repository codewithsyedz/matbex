#!/usr/bin/env node
/**
 * Cutover ledger fixes (accounting decisions of 2026-11-11; migrations 20261111124900 and
 * 20261111190452). Run once against the production database right after the data move:
 *
 *   DATABASE_URL=postgres://... node server/scripts/cutover-ledger-fixes.mjs            # report only
 *   DATABASE_URL=postgres://... node server/scripts/cutover-ledger-fixes.mjs --apply    # do it
 *
 * Per business (tenant), in one transaction:
 *
 * 1. Customer receivables: a DRAFT journal (approval_status 'pending', nothing posted) that an
 *    owner or manager approves on the pending journal entries screen:
 *      DR 1100 / CR 1130   customer receipts that were credited to 1100 (delivery-platform
 *                          receivables) instead of the customer accounts
 *      DR 1130 / CR 1999   bring Customer Accounts (1130) to what customers owe (positive
 *                          customer balances); 1999 "Cutover Clearing" is cleared by the
 *                          accountant against the cash count and delivery-platform statements
 *      DR 1010 / CR 1130   settlement-invoice payments that never reached the ledger,
 *                          recorded against the bank (accountant sign-off, 2026-11-12)
 *
 * 2. Unpaid cash/bank expenses WITH a receipt attached are marked paid (paid_amount = amount);
 *    the expense triggers move their credit from Accounts Payable to the payment account.
 *    Expenses without a receipt stay open for the accountant. Rows the database refuses
 *    (for example a locked period) are reported and skipped.
 *
 * Safe to re-run: a business that already has the draft (reference CUTOVER-AR) is skipped
 * for step 1, and step 2 only touches expenses that are still unpaid.
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const REF = "CUTOVER-AR";
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);

async function clearingAccount(tx, tenantId) {
  const [found] = await tx`
    select id from chart_of_accounts where tenant_id = ${tenantId} and account_code = '1999' and is_active limit 1`;
  if (found) return found.id;
  const [made] = await tx`
    insert into chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
    values (${tenantId}, '1999', 'Cutover Clearing', 'asset',
            'Temporary: differences found at the move to the new system; cleared by the accountant')
    returning id`;
  return made.id;
}

async function tenantFixes(tx, t) {
  const out = { name: t.name, draft: null, unposted: [], paid: [], refused: [], open: [] };

  // --- 1. Customer receivables draft ---
  const [{ exists }] = await tx`
    select exists (select 1 from journal_entry_batches where tenant_id = ${t.id} and reference_number = ${REF}) as exists`;
  const [ar] = await tx`select id from chart_of_accounts where tenant_id = ${t.id} and account_code = '1100' and is_active limit 1`;
  const [{ cust }] = await tx`select public.customer_receivable_account(${t.id}) as cust`;
  const [{ misapplied }] = await tx`
    select coalesce(sum(tr.credit), 0)::float8 as misapplied
    from account_transactions tr join chart_of_accounts a on a.id = tr.account_id
    where tr.tenant_id = ${t.id} and a.account_code = '1100' and not coalesce(tr.is_voided, false)
      and tr.reference_type in ('settlement', 'customer_receipt')`;
  const [{ owed, credit_balances }] = await tx`
    select coalesce(sum(c.current_balance) filter (where c.current_balance > 0), 0)::float8 as owed,
           coalesce(sum(c.current_balance) filter (where c.current_balance < 0), 0)::float8 as credit_balances
    from customers c join restaurants r on r.id = c.restaurant_id where r.tenant_id = ${t.id}`;
  const [{ bal1130 }] = await tx`
    select coalesce(sum(tr.debit - tr.credit), 0)::float8 as bal1130
    from account_transactions tr where tr.account_id = ${cust} and not coalesce(tr.is_voided, false)`;
  out.unposted = await tx`
    select to_char(sp.created_at, 'YYYY-MM-DD') as paid_on, si.invoice_number, sp.amount::float8 as amount, sp.payment_method
    from settlement_payments sp join settlement_invoices si on si.id = sp.settlement_invoice_id
    join restaurants r on r.id = sp.restaurant_id
    where r.tenant_id = ${t.id} and not coalesce(sp.ledger_posted, false) order by sp.created_at`;

  const [bank] = await tx`select id from chart_of_accounts where tenant_id = ${t.id} and account_code = '1010' and is_active limit 1`;
  const unpostedTotal = money(out.unposted.reduce((a, u) => a + u.amount, 0));
  if (unpostedTotal > 0 && !bank) throw new Error("Bank account 1010 is missing; cannot record the unposted invoice payments");
  // After the reclass and the payments, 1130 stands at bal1130 - misapplied - unpostedTotal;
  // move it to what customers owe.
  const toTarget = money(owed - (bal1130 - misapplied - unpostedTotal));
  const lines = [];
  if (money(misapplied) > 0 && ar) {
    lines.push({ account_id: ar.id, debit: money(misapplied), credit: 0, description: "Customer receipts credited to delivery receivables (1100): moved to Customer Accounts" });
    lines.push({ account_id: cust, debit: 0, credit: money(misapplied), description: "Customer receipts credited to delivery receivables (1100): moved to Customer Accounts" });
  }
  for (const u of out.unposted) {
    const d = `Invoice ${u.invoice_number} payment of ${u.paid_on} (${u.payment_method}), not in the ledger: recorded against the bank`;
    lines.push({ account_id: bank.id, debit: money(u.amount), credit: 0, description: d });
    lines.push({ account_id: cust, debit: 0, credit: money(u.amount), description: d });
  }
  if (toTarget !== 0) {
    const clearing = APPLY && !exists ? await clearingAccount(tx, t.id) : "1999";
    const d = "Customer Accounts set to what customers owe at cutover (customer balances)";
    lines.push(toTarget > 0
      ? { account_id: cust, debit: toTarget, credit: 0, description: d }
      : { account_id: cust, debit: 0, credit: -toTarget, description: d });
    lines.push(toTarget > 0
      ? { account_id: clearing, debit: 0, credit: toTarget, description: "Cutover clearing: reconcile against cash count and delivery statements" }
      : { account_id: clearing, debit: -toTarget, credit: 0, description: "Cutover clearing: reconcile against cash count and delivery statements" });
  }
  out.draft = { exists, unpostedTotal, misapplied: money(misapplied), owed: money(owed), creditBalances: money(credit_balances), bal1130: money(bal1130), toTarget, lines: lines.length };
  if (APPLY && !exists && lines.length) {
    const [owner] = await tx`
      select user_id from user_tenant_roles where tenant_id = ${t.id} and role = 'owner' order by created_at limit 1`;
    await tx`
      insert into journal_entry_batches (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
                                         created_by, is_posted, approval_status, pending_lines)
      values (${t.id}, current_date, 'Cutover: customer receivables correction (draft for approval)', ${REF}, 'adjustment', 'manual',
              ${owner?.user_id ?? null}, false, 'pending', ${tx.json(lines)})`;
  }

  // --- 2. Receipted cash/bank expenses still unpaid ---
  const rows = await tx`
    select e.id, to_char(e.expense_date, 'YYYY-MM-DD') as expense_date, e.description, e.amount::float8 as amount, coalesce(e.receipt_url, '') <> '' as has_receipt
    from expenses e join restaurants r on r.id = e.restaurant_id
    where r.tenant_id = ${t.id} and e.deleted_at is null and e.status = 'unpaid' and e.payment_account_id is not null
    order by e.expense_date`;
  for (const e of rows) {
    if (!e.has_receipt) { out.open.push(e); continue; }
    if (!APPLY) { out.paid.push(e); continue; }
    try {
      await tx.savepoint((sp) => sp`update expenses set paid_amount = amount where id = ${e.id} and status = 'unpaid'`);
      out.paid.push(e);
    } catch (err) {
      out.refused.push({ ...e, reason: err.message });
    }
  }
  return out;
}

const tenants = await sql`select id, name from tenants order by name`;
let failed = false;
console.log(APPLY ? "== APPLYING cutover ledger fixes" : "== Report only (add --apply to make the changes)");
for (const t of tenants) {
  try {
    const r = await sql.begin((tx) => tenantFixes(tx, t));
    const d = r.draft;
    if (!d.lines && !r.paid.length && !r.open.length && !r.unposted.length) continue;
    console.log(`\n## ${r.name}`);
    if (d.exists) console.log(`  receivables draft: already created (${REF}), skipped`);
    else if (d.lines) {
      console.log(`  receivables draft${APPLY ? " created (pending approval)" : ""}: move receipts ${fmt(d.misapplied)} from 1100 to 1130; ` +
        `record ${r.unposted.length} unposted invoice payments ${fmt(d.unpostedTotal)} DR 1010 Bank / CR 1130; ` +
        `set 1130 to ${fmt(d.owed)} owed (was ${fmt(d.bal1130)}), ${fmt(d.toTarget)} via 1999 Cutover Clearing`);
      if (d.creditBalances) console.log(`  note: customers in credit total ${fmt(-d.creditBalances)} (a liability, not netted here)`);
    }
    for (const u of r.unposted) console.log(`  in the draft: ${u.paid_on} ${u.invoice_number} ${fmt(u.amount)} (${u.payment_method}) DR 1010 Bank`);
    if (r.paid.length) console.log(`  receipted expenses ${APPLY ? "marked paid" : "to mark paid"}: ${r.paid.length}, ${fmt(r.paid.reduce((a, e) => a + e.amount, 0))}`);
    for (const e of r.refused) console.log(`  refused: ${e.expense_date} ${fmt(e.amount)} ${e.description ?? ""}: ${e.reason}`);
    if (r.open.length) console.log(`  left open, no receipt: ${r.open.length}, ${fmt(r.open.reduce((a, e) => a + e.amount, 0))}`);
  } catch (err) {
    failed = true;
    console.error(`\n## ${t.name}: FAILED, nothing changed for this business: ${err.message}`);
  }
}
await sql.end();
process.exit(failed ? 1 : 0);
