#!/usr/bin/env node
/**
 * Tenant-isolation audit for the schema built by db/migrate.mjs (CI runs it on a fresh database).
 *
 * Fails when, in schema public, a table that has a tenant_id or restaurant_id column:
 *   1. has row-level security switched off, or
 *   2. has a policy for anon / authenticated / public that is open to everyone
 *      (USING true, or WITH CHECK true on INSERT) and is not on the allow-list below.
 *
 * Every allow-list entry is an intentional public feature; add new ones only with a reason.
 *
 *   DATABASE_URL=postgres://... node db/check-rls.mjs
 */
import postgres from "postgres";

const ALLOWED_OPEN_POLICIES = {
  "client_errors / Anyone can log a client error": "browser error reports, insert-only",
  "menu_item_branch_availability / Public read menu branch availability": "public storefront menu",
  "restaurant_branding / Public can view branding for public pages": "public storefront branding",
  "tenant_applications / Anyone can submit applications": "public signup form, insert-only",
};

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });

const scoped = await sql`
  select c.relname as table, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and exists (select 1 from pg_attribute a where a.attrelid = c.oid
                and a.attname in ('tenant_id', 'restaurant_id') and not a.attisdropped)
  order by 1`;
const open = await sql`
  select p.tablename || ' / ' || p.policyname as key, p.cmd, array_to_string(p.roles, ',') as roles
  from pg_policies p
  where p.schemaname = 'public'
    and (p.qual in ('true', '(true)') or (p.cmd = 'INSERT' and p.with_check in ('true', '(true)')))
    and p.roles && array['authenticated', 'anon', 'public']::name[]
    and p.tablename = any(${scoped.map((r) => r.table)})
  order by 1`;
await sql.end();

const rlsOff = scoped.filter((r) => !r.rls).map((r) => r.table);
const unexpected = open.filter((p) => !ALLOWED_OPEN_POLICIES[p.key]);
const stale = Object.keys(ALLOWED_OPEN_POLICIES).filter((k) => !open.some((p) => p.key === k));

console.log(`tenant-scoped tables: ${scoped.length}, RLS off: ${rlsOff.length}, open policies: ${open.length} (${open.length - unexpected.length} allowed)`);
for (const t of rlsOff) console.error(`RLS OFF: ${t}`);
for (const p of unexpected) console.error(`OPEN POLICY (not allowed): ${p.key} [${p.cmd} to ${p.roles}]`);
for (const k of stale) console.warn(`allow-list entry no longer needed: ${k}`);
process.exit(rlsOff.length || unexpected.length ? 1 : 0);
