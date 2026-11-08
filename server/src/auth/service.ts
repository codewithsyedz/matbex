/**
 * Auth domain logic: users, sessions, refresh-token rotation, one-time tokens.
 * Storage lives in the `auth` schema (db/platform/000_platform.sql).
 */
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { config } from "../config.js";
import { sql, type Tx } from "../db.js";
import { badRequest, HttpError, unauthorized } from "../lib/errors.js";
import { sign, type AccessClaims } from "../lib/jwt.js";

export interface UserRow {
  id: string;
  aud: string;
  role: string;
  email: string | null;
  phone: string | null;
  encrypted_password: string | null;
  email_confirmed_at: Date | null;
  email_change: string | null;
  phone_confirmed_at: Date | null;
  confirmed_at: Date | null;
  last_sign_in_at: Date | null;
  raw_app_meta_data: Record<string, any>;
  raw_user_meta_data: Record<string, any>;
  created_at: Date;
  updated_at: Date;
  banned_until: Date | null;
  deleted_at: Date | null;
  is_anonymous: boolean;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export function normalizeEmail(email: unknown): string {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw badRequest("Invalid email address", "email_address_invalid");
  return email.trim().toLowerCase();
}

export function assertPassword(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < config.AUTH_MIN_PASSWORD_LENGTH) {
    throw new HttpError(422, `Password should be at least ${config.AUTH_MIN_PASSWORD_LENGTH} characters.`, "weak_password");
  }
  return pw;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);

/** Public user object (same field names the web app already reads). */
export async function toPublicUser(u: UserRow) {
  const factors = await sql`
    select id, friendly_name, factor_type, status, created_at, updated_at
    from auth.mfa_factors where user_id = ${u.id} order by created_at`;
  return {
    id: u.id,
    aud: u.aud ?? "authenticated",
    role: u.role ?? "authenticated",
    email: u.email ?? undefined,
    phone: u.phone ?? "",
    email_confirmed_at: iso(u.email_confirmed_at),
    phone_confirmed_at: iso(u.phone_confirmed_at),
    confirmed_at: iso(u.confirmed_at),
    last_sign_in_at: iso(u.last_sign_in_at),
    created_at: iso(u.created_at)!,
    updated_at: iso(u.updated_at)!,
    app_metadata: { provider: "email", providers: ["email"], ...(u.raw_app_meta_data ?? {}) },
    user_metadata: u.raw_user_meta_data ?? {},
    identities: [],
    factors: factors.map((f) => ({ ...f, created_at: iso(f.created_at), updated_at: iso(f.updated_at) })),
    is_anonymous: u.is_anonymous ?? false,
  };
}

export async function getUserById(id: string, tx: Tx | typeof sql = sql): Promise<UserRow | null> {
  const [u] = await tx<UserRow[]>`select * from auth.users where id = ${id} and deleted_at is null`;
  return u ?? null;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const [u] = await sql<UserRow[]>`select * from auth.users where lower(email) = ${email.toLowerCase()} and deleted_at is null`;
  return u ?? null;
}

export async function createUser(attrs: {
  email: string;
  password?: string | null;
  phone?: string | null;
  confirmed?: boolean;
  userMeta?: Record<string, unknown>;
  appMeta?: Record<string, unknown>;
  invited?: boolean;
}): Promise<UserRow> {
  const email = normalizeEmail(attrs.email);
  if (await getUserByEmail(email)) throw new HttpError(422, "User already registered", "user_already_exists");
  const hash = attrs.password ? await hashPassword(assertPassword(attrs.password)) : null;
  const [u] = await sql<UserRow[]>`
    insert into auth.users (email, encrypted_password, phone, email_confirmed_at, invited_at,
                            raw_user_meta_data, raw_app_meta_data, aud, role)
    values (${email}, ${hash}, ${attrs.phone ?? null},
            ${attrs.confirmed ? sql`now()` : null}, ${attrs.invited ? sql`now()` : null},
            ${sql.json((attrs.userMeta ?? {}) as any)},
            ${sql.json({ provider: "email", providers: ["email"], ...(attrs.appMeta ?? {}) } as any)},
            'authenticated', 'authenticated')
    returning *`;
  return u;
}

export function assertCanSignIn(u: UserRow) {
  if (u.banned_until && new Date(u.banned_until) > new Date()) throw new HttpError(400, "User is banned", "user_banned");
  if (u.deleted_at) throw new HttpError(400, "Invalid login credentials", "invalid_credentials");
}

// --------------------------------------------------------------------- sessions
export interface SessionResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: Awaited<ReturnType<typeof toPublicUser>>;
}

async function accessToken(u: UserRow, session: { id: string; aal: string }, amr: AccessClaims["amr"]) {
  const claims: Partial<AccessClaims> = {
    iss: `${config.API_URL}/auth/v1`,
    sub: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email ?? undefined,
    phone: u.phone ?? "",
    app_metadata: { provider: "email", providers: ["email"], ...(u.raw_app_meta_data ?? {}) },
    user_metadata: u.raw_user_meta_data ?? {},
    aal: session.aal as "aal1" | "aal2",
    amr,
    session_id: session.id,
    is_anonymous: u.is_anonymous ?? false,
  };
  return sign(claims as Record<string, unknown>, config.JWT_EXPIRY_SECONDS);
}

async function issueRefresh(tx: Tx | typeof sql, userId: string, sessionId: string, parentId: number | null) {
  const token = randomToken(24);
  await tx`
    insert into auth.refresh_tokens (token_hash, user_id, session_id, parent_id)
    values (${sha256(token)}, ${userId}, ${sessionId}, ${parentId})`;
  return token;
}

export async function startSession(
  u: UserRow,
  method: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<SessionResponse> {
  assertCanSignIn(u);
  return sql.begin(async (tx) => {
    const [s] = await tx<{ id: string; aal: string }[]>`
      insert into auth.sessions (user_id, aal, user_agent, ip, refreshed_at)
      values (${u.id}, 'aal1', ${meta.userAgent ?? null}, ${meta.ip ?? null}, now())
      returning id, aal`;
    await tx`update auth.users set last_sign_in_at = now(), updated_at = now() where id = ${u.id}`;
    const refresh = await issueRefresh(tx, u.id, s.id, null);
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: await accessToken(u, s, [{ method, timestamp: now }]),
      token_type: "bearer" as const,
      expires_in: config.JWT_EXPIRY_SECONDS,
      expires_at: now + config.JWT_EXPIRY_SECONDS,
      refresh_token: refresh,
      user: await toPublicUser(u),
    };
  }) as Promise<SessionResponse>;
}

/** Rotate a refresh token. Reuse of a revoked token outside the grace window revokes the session. */
export async function refreshSession(token: string): Promise<SessionResponse> {
  if (!token) throw badRequest("refresh_token required", "refresh_token_not_found");
  const result = await sql.begin(async (tx) => {
    const [rt] = await tx<{ id: number; user_id: string; session_id: string; revoked: boolean; created_at: Date }[]>`
      select id, user_id, session_id, revoked, created_at from auth.refresh_tokens
      where token_hash = ${sha256(token)} for update`;
    if (!rt) throw new HttpError(400, "Invalid Refresh Token: Refresh Token Not Found", "refresh_token_not_found");

    if (rt.revoked) {
      const [child] = await tx<{ created_at: Date }[]>`
        select created_at from auth.refresh_tokens where parent_id = ${rt.id} order by id desc limit 1`;
      const withinGrace = child && Date.now() - new Date(child.created_at).getTime() < config.REFRESH_TOKEN_REUSE_SECONDS * 1000;
      if (!withinGrace) {
        await tx`delete from auth.sessions where id = ${rt.session_id}`;
        throw new HttpError(400, "Invalid Refresh Token: Already Used", "refresh_token_already_used");
      }
    }

    const [s] = await tx<{ id: string; aal: string; not_after: Date | null }[]>`
      select id, aal, not_after from auth.sessions where id = ${rt.session_id}`;
    if (!s || (s.not_after && new Date(s.not_after) < new Date())) {
      throw new HttpError(400, "Invalid Refresh Token: Session Expired", "session_expired");
    }
    const u = await getUserById(rt.user_id, tx);
    if (!u) throw new HttpError(400, "User not found", "user_not_found");
    assertCanSignIn(u);

    await tx`update auth.refresh_tokens set revoked = true where id = ${rt.id}`;
    await tx`update auth.sessions set refreshed_at = now(), updated_at = now() where id = ${s.id}`;
    const refresh = await issueRefresh(tx, u.id, s.id, rt.id);
    return { u, s, refresh };
  });

  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: await accessToken(result.u, result.s, [{ method: "token_refresh", timestamp: now }]),
    token_type: "bearer",
    expires_in: config.JWT_EXPIRY_SECONDS,
    expires_at: now + config.JWT_EXPIRY_SECONDS,
    refresh_token: result.refresh,
    user: await toPublicUser(result.u),
  };
}

/** Upgrade a session to aal2 after a successful MFA verification and issue fresh tokens. */
export async function elevateSession(userId: string, sessionId: string, factorId: string): Promise<SessionResponse> {
  const u = await getUserById(userId);
  if (!u) throw unauthorized();
  const out = await sql.begin(async (tx) => {
    const [s] = await tx<{ id: string; aal: string }[]>`
      update auth.sessions set aal = 'aal2', factor_id = ${factorId}, updated_at = now()
      where id = ${sessionId} and user_id = ${userId} returning id, aal`;
    if (!s) throw unauthorized("Session not found");
    await tx`update auth.refresh_tokens set revoked = true where session_id = ${s.id} and not revoked`;
    const refresh = await issueRefresh(tx, userId, s.id, null);
    return { s, refresh };
  });
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: await accessToken(u, out.s, [{ method: "totp", timestamp: now }]),
    token_type: "bearer",
    expires_in: config.JWT_EXPIRY_SECONDS,
    expires_at: now + config.JWT_EXPIRY_SECONDS,
    refresh_token: out.refresh,
    user: await toPublicUser(u),
  };
}

export async function endSessions(userId: string, sessionId: string | undefined, scope: "global" | "local" | "others") {
  if (scope === "global") await sql`delete from auth.sessions where user_id = ${userId}`;
  else if (scope === "local" && sessionId) await sql`delete from auth.sessions where id = ${sessionId}`;
  else if (scope === "others" && sessionId) await sql`delete from auth.sessions where user_id = ${userId} and id <> ${sessionId}`;
}

// -------------------------------------------------------------- one-time tokens
export type OttType = "signup" | "recovery" | "invite" | "magiclink" | "email_change";

const OTT_TTL_MIN: Record<OttType, number> = { signup: 24 * 60, recovery: 60, invite: 7 * 24 * 60, magiclink: 60, email_change: 24 * 60 };

/** Returns { token_hash (for links), otp (6-digit code for manual entry) }. */
export async function createOneTimeToken(userId: string, type: OttType, relatesTo?: string) {
  const tokenHash = randomToken(24);
  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await sql`delete from auth.one_time_tokens where user_id = ${userId} and token_type = ${type}`;
  const expires = new Date(Date.now() + OTT_TTL_MIN[type] * 60_000);
  await sql`
    insert into auth.one_time_tokens (user_id, token_type, token_hash, relates_to, expires_at)
    values (${userId}, ${type}, ${sha256(tokenHash)}, ${relatesTo ?? null}, ${expires}),
           (${userId}, ${type}, ${sha256(`${userId}:${otp}`)}, ${relatesTo ?? null}, ${expires})`;
  return { tokenHash, otp };
}

export async function consumeOneTimeToken(type: string, input: { token_hash?: string; email?: string; token?: string }) {
  let hash: string | null = null;
  if (input.token_hash) hash = sha256(input.token_hash);
  else if (input.email && input.token) {
    const u = await getUserByEmail(normalizeEmail(input.email));
    if (!u) throw new HttpError(403, "Token has expired or is invalid", "otp_expired");
    hash = sha256(`${u.id}:${input.token}`);
  }
  if (!hash) throw badRequest("token_hash or (email, token) required");
  const types = type === "email" ? ["signup", "magiclink"] : [type];
  const [row] = await sql<{ id: string; user_id: string; token_type: OttType; relates_to: string | null }[]>`
    update auth.one_time_tokens set used_at = now()
    where token_hash = ${hash} and token_type = any(${types}) and used_at is null and expires_at > now()
    returning id, user_id, token_type, relates_to`;
  if (!row) throw new HttpError(403, "Email link is invalid or has expired", "otp_expired");
  await sql`delete from auth.one_time_tokens where user_id = ${row.user_id} and token_type = ${row.token_type}`;

  if (row.token_type === "signup" || row.token_type === "invite" || row.token_type === "magiclink") {
    await sql`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = ${row.user_id}`;
  }
  if (row.token_type === "email_change" && row.relates_to) {
    await sql`update auth.users set email = ${row.relates_to}, email_change = null, email_confirmed_at = now(), updated_at = now() where id = ${row.user_id}`;
  }
  const u = await getUserById(row.user_id);
  if (!u) throw new HttpError(403, "User not found", "user_not_found");
  return { user: u, type: row.token_type };
}

export function verifyLink(tokenHash: string, type: OttType, redirectTo?: string) {
  const u = new URL(`${config.API_URL}/auth/v1/verify`);
  u.searchParams.set("token", tokenHash);
  u.searchParams.set("type", type);
  if (redirectTo) u.searchParams.set("redirect_to", redirectTo);
  return u.toString();
}
