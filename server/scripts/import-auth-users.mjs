#!/usr/bin/env node
/**
 * Copies users from the old hosted project into the self-hosted auth.users.
 *
 *   SOURCE_DATABASE_URL=postgres://...old...  DATABASE_URL=postgres://...new...  node scripts/import-auth-users.mjs
 *
 * Password hashes are bcrypt in both systems, so users keep their passwords.
 * MFA (TOTP) factors are copied too. Existing sessions are not (users sign in again).
 * Run it BEFORE restoring public-schema data, because many tables reference auth.users(id).
 */
import postgres from "postgres";

const src = postgres(process.env.SOURCE_DATABASE_URL, { max: 1 });
const dst = postgres(process.env.DATABASE_URL, { max: 1 });

const users = await src`
  select id, email, encrypted_password, email_confirmed_at, invited_at, confirmation_sent_at, recovery_sent_at,
         last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
         phone, phone_confirmed_at, banned_until, deleted_at, coalesce(is_anonymous, false) as is_anonymous
  from auth.users`;

let n = 0;
for (const u of users) {
  await dst`
    insert into auth.users ${dst(u, Object.keys(u))}
    on conflict (id) do update set
      email = excluded.email, encrypted_password = excluded.encrypted_password,
      email_confirmed_at = excluded.email_confirmed_at, raw_app_meta_data = excluded.raw_app_meta_data,
      raw_user_meta_data = excluded.raw_user_meta_data, banned_until = excluded.banned_until,
      updated_at = excluded.updated_at`;
  n++;
}

let f = 0;
try {
  const factors = await src`
    select id, user_id, friendly_name, factor_type::text, status::text, secret, created_at, updated_at
    from auth.mfa_factors where factor_type = 'totp' and secret is not null`;
  for (const x of factors) {
    await dst`insert into auth.mfa_factors ${dst(x, Object.keys(x))} on conflict (id) do nothing`;
    f++;
  }
} catch (e) {
  console.warn("MFA factors not copied:", e.message);
}

console.log(`imported ${n} users, ${f} MFA factors`);
await src.end();
await dst.end();
