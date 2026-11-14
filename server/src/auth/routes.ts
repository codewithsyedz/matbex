/**
 * /auth/v1 — password auth, sessions, email flows, TOTP MFA, admin users.
 * Response shapes match what @matbex/client (and the web app) expect.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { config, safeRedirect } from "../config.js";
import { sql } from "../db.js";
import { sendAuthEmail } from "../email/auth-emails.js";
import { badRequest, forbidden, HttpError, notFound, unauthorized } from "../lib/errors.js";
import { bearer, verify, type AccessClaims } from "../lib/jwt.js";
import {
  assertPassword,
  consumeOneTimeToken,
  createOneTimeToken,
  createUser,
  elevateSession,
  endSessions,
  getUserByEmail,
  getUserById,
  hashPassword,
  normalizeEmail,
  refreshSession,
  startSession,
  toPublicUser,
  verifyLink,
  type OttType,
} from "./service.js";

async function requireUser(req: FastifyRequest): Promise<AccessClaims> {
  const token = bearer(req.headers.authorization);
  if (!token) throw unauthorized("Auth session missing!", "no_authorization");
  let claims: AccessClaims;
  try {
    claims = await verify(token);
  } catch {
    throw new HttpError(403, "invalid JWT: unable to parse or verify signature", "bad_jwt");
  }
  if (claims.role !== "authenticated" || !claims.sub) throw forbidden("User token required", "bad_jwt");
  if (claims.session_id) {
    const [s] = await sql`select 1 from auth.sessions where id = ${claims.session_id}`;
    if (!s) throw new HttpError(403, "Session from session_id claim in JWT does not exist", "session_not_found");
  }
  return claims;
}

async function requireServiceRole(req: FastifyRequest) {
  const token = bearer(req.headers.authorization);
  if (!token) throw unauthorized();
  const claims = await verify(token).catch(() => null);
  if (claims?.role !== "service_role") throw forbidden("User not allowed", "not_admin");
}

const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "") });

export async function authRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ name: "matbex-auth", version: "1", description: "Matbex auth service" }));

  app.get("/settings", async () => ({
    external: { email: true, phone: false },
    disable_signup: config.AUTH_DISABLE_SIGNUP,
    mailer_autoconfirm: config.AUTH_AUTOCONFIRM,
  }));

  // ---------------------------------------------------------------- tokens
  app.post<{ Querystring: { grant_type?: string }; Body: any }>(
    "/token",
    { config: { rateLimit: { max: 30, timeWindow: "5 minutes" } } },
    async (req) => {
      const grant = req.query.grant_type;
      const body = (req.body ?? {}) as any;
      if (grant === "password") {
        const email = normalizeEmail(body.email);
        const u = await getUserByEmail(email);
        const ok = u?.encrypted_password ? await bcrypt.compare(String(body.password ?? ""), u.encrypted_password) : false;
        if (!u || !ok) throw new HttpError(400, "Invalid login credentials", "invalid_credentials");
        if (!u.email_confirmed_at && !config.AUTH_AUTOCONFIRM) throw new HttpError(400, "Email not confirmed", "email_not_confirmed");
        return startSession(u, "password", meta(req));
      }
      if (grant === "refresh_token") return refreshSession(String(body.refresh_token ?? ""));
      throw badRequest("unsupported_grant_type", "unsupported_grant_type");
    },
  );

  app.post<{ Body: any }>("/signup", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    if (config.AUTH_DISABLE_SIGNUP) throw forbidden("Signups not allowed for this instance", "signup_disabled");
    const { email, password, data, redirect_to } = (req.body ?? {}) as any;
    const u = await createUser({ email, password, userMeta: data, confirmed: config.AUTH_AUTOCONFIRM });
    if (config.AUTH_AUTOCONFIRM) {
      const session = await startSession(u, "password", meta(req));
      return { user: session.user, session };
    }
    const { tokenHash } = await createOneTimeToken(u.id, "signup");
    await sql`update auth.users set confirmation_sent_at = now() where id = ${u.id}`;
    await sendAuthEmail("signup", u.email!, { url: verifyLink(tokenHash, "signup", safeRedirect(redirect_to)) });
    return { user: await toPublicUser(u), session: null };
  });

  app.post<{ Querystring: { scope?: "global" | "local" | "others" } }>("/logout", async (req, reply) => {
    const claims = await requireUser(req).catch(() => null);
    if (claims) await endSessions(claims.sub, claims.session_id, req.query.scope ?? "global");
    reply.code(204).send();
  });

  app.get("/user", async (req) => {
    const c = await requireUser(req);
    const u = await getUserById(c.sub);
    if (!u) throw notFound("User not found", "user_not_found");
    return toPublicUser(u);
  });

  app.get("/claims", async (req) => {
    const token = bearer(req.headers.authorization);
    if (!token) throw unauthorized();
    const claims = await verify(token).catch(() => {
      throw new HttpError(401, "invalid JWT", "bad_jwt");
    });
    return { claims };
  });

  app.put<{ Body: any }>("/user", async (req) => {
    const c = await requireUser(req);
    const { email, password, data } = (req.body ?? {}) as any;
    let u = await getUserById(c.sub);
    if (!u) throw notFound("User not found");
    if (password !== undefined) {
      const hash = await hashPassword(assertPassword(password));
      await sql`update auth.users set encrypted_password = ${hash}, updated_at = now() where id = ${u.id}`;
      // keep current session, drop others (password change)
      if (c.session_id) await endSessions(u.id, c.session_id, "others");
    }
    if (data && typeof data === "object") {
      await sql`update auth.users set raw_user_meta_data = raw_user_meta_data || ${sql.json(data)}, updated_at = now() where id = ${u.id}`;
    }
    if (email !== undefined && normalizeEmail(email) !== u.email) {
      const next = normalizeEmail(email);
      if (await getUserByEmail(next)) throw new HttpError(422, "A user with this email address has already been registered", "email_exists");
      if (config.AUTH_AUTOCONFIRM) {
        await sql`update auth.users set email = ${next}, email_confirmed_at = now(), updated_at = now() where id = ${u.id}`;
      } else {
        await sql`update auth.users set email_change = ${next} where id = ${u.id}`;
        const { tokenHash } = await createOneTimeToken(u.id, "email_change", next);
        await sendAuthEmail("email_change", next, { url: verifyLink(tokenHash, "email_change"), oldEmail: u.email ?? "", newEmail: next });
      }
    }
    u = await getUserById(c.sub);
    return toPublicUser(u!);
  });

  app.post<{ Body: any }>("/recover", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const email = normalizeEmail((req.body as any)?.email);
    const u = await getUserByEmail(email);
    if (u) {
      const { tokenHash } = await createOneTimeToken(u.id, "recovery");
      await sql`update auth.users set recovery_sent_at = now() where id = ${u.id}`;
      await sendAuthEmail("recovery", email, { url: verifyLink(tokenHash, "recovery", safeRedirect((req.body as any)?.redirect_to)) });
    }
    return {}; // never reveal whether the address exists
  });

  /** Email link target: verify, start a session, redirect with tokens in the fragment. */
  app.get<{ Querystring: { token?: string; type?: string; redirect_to?: string } }>("/verify", async (req, reply) => {
    const redirect = safeRedirect(req.query.redirect_to);
    try {
      const { user, type } = await consumeOneTimeToken(String(req.query.type ?? ""), { token_hash: req.query.token });
      const s = await startSession(user, "otp", meta(req));
      const frag = new URLSearchParams({
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_in: String(s.expires_in),
        expires_at: String(s.expires_at),
        token_type: "bearer",
        type,
      });
      return reply.redirect(`${redirect.split("#")[0]}#${frag}`, 303);
    } catch (e: any) {
      const frag = new URLSearchParams({ error: "access_denied", error_code: e?.code ?? "otp_expired", error_description: e?.message ?? "Invalid link" });
      return reply.redirect(`${redirect.split("#")[0]}#${frag}`, 303);
    }
  });

  app.post<{ Body: any }>("/verify", async (req) => {
    const { type, token_hash, email, token } = (req.body ?? {}) as any;
    const { user } = await consumeOneTimeToken(String(type ?? ""), { token_hash, email, token });
    return startSession(user, "otp", meta(req));
  });

  app.post<{ Body: any }>("/resend", async (req) => {
    const { type, email, options } = (req.body ?? {}) as any;
    const u = await getUserByEmail(normalizeEmail(email));
    if (u && (type === "signup" || type === "email_change")) {
      const { tokenHash } = await createOneTimeToken(u.id, type as OttType, u.email_change ?? undefined);
      await sendAuthEmail(type, type === "email_change" ? u.email_change ?? u.email! : u.email!, {
        url: verifyLink(tokenHash, type as OttType, safeRedirect(options?.emailRedirectTo)),
      });
    }
    return {};
  });

  // ---------------------------------------------------------------- MFA (TOTP)
  app.get("/factors", async (req) => {
    const c = await requireUser(req);
    return sql`select id, friendly_name, factor_type, status, created_at, updated_at from auth.mfa_factors where user_id = ${c.sub} order by created_at`;
  });

  app.post<{ Body: any }>("/factors", async (req) => {
    const c = await requireUser(req);
    if (((req.body as any)?.factor_type ?? "totp") !== "totp") throw badRequest("Only TOTP factors are supported");
    await sql`delete from auth.mfa_factors where user_id = ${c.sub} and status = 'unverified'`;
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: (req.body as any)?.issuer ?? config.AUTH_MFA_ISSUER,
      label: c.email ?? c.sub,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
    const [f] = await sql<{ id: string }[]>`
      insert into auth.mfa_factors (user_id, friendly_name, factor_type, status, secret)
      values (${c.sub}, ${(req.body as any)?.friendly_name ?? null}, 'totp', 'unverified', ${secret.base32})
      returning id`;
    const uri = totp.toString();
    const svg = await QRCode.toString(uri, { type: "svg", margin: 1 });
    return {
      id: f.id,
      type: "totp",
      friendly_name: (req.body as any)?.friendly_name ?? null,
      totp: { qr_code: `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`, secret: secret.base32, uri },
    };
  });

  app.post<{ Params: { id: string } }>("/factors/:id/challenge", async (req) => {
    const c = await requireUser(req);
    const [f] = await sql`select id from auth.mfa_factors where id = ${req.params.id} and user_id = ${c.sub}`;
    if (!f) throw notFound("Factor not found", "mfa_factor_not_found");
    const [ch] = await sql<{ id: string; created_at: Date }[]>`
      insert into auth.mfa_challenges (factor_id, ip_address) values (${f.id}, ${req.ip}) returning id, created_at`;
    return { id: ch.id, type: "totp", expires_at: Math.floor(new Date(ch.created_at).getTime() / 1000) + 300 };
  });

  app.post<{ Params: { id: string }; Body: any }>(
    "/factors/:id/verify",
    { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (req) => {
      const c = await requireUser(req);
      const [f] = await sql<{ id: string; secret: string }[]>`
        select id, secret from auth.mfa_factors where id = ${req.params.id} and user_id = ${c.sub}`;
      if (!f) throw notFound("Factor not found", "mfa_factor_not_found");
      const [ch] = await sql`
        select id from auth.mfa_challenges
        where id = ${(req.body as any)?.challenge_id} and factor_id = ${f.id} and verified_at is null
          and created_at > now() - interval '5 minutes'`;
      if (!ch) throw new HttpError(422, "Challenge expired or not found", "mfa_challenge_expired");
      const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(f.secret), digits: 6, period: 30, algorithm: "SHA1" });
      if (totp.validate({ token: String((req.body as any)?.code ?? ""), window: 1 }) === null) {
        throw new HttpError(422, "Invalid TOTP code entered", "mfa_verification_failed");
      }
      await sql`update auth.mfa_challenges set verified_at = now() where id = ${ch.id}`;
      await sql`update auth.mfa_factors set status = 'verified', updated_at = now(), last_challenged_at = now() where id = ${f.id}`;
      if (!c.session_id) throw unauthorized("Session missing");
      return elevateSession(c.sub, c.session_id, f.id);
    },
  );

  app.delete<{ Params: { id: string } }>("/factors/:id", async (req) => {
    const c = await requireUser(req);
    const [f] = await sql<{ status: string }[]>`select status from auth.mfa_factors where id = ${req.params.id} and user_id = ${c.sub}`;
    if (!f) throw notFound("Factor not found", "mfa_factor_not_found");
    if (f.status === "verified" && c.aal !== "aal2") throw forbidden("AAL2 required to unenroll a verified factor", "insufficient_aal");
    await sql`delete from auth.mfa_factors where id = ${req.params.id}`;
    return { id: req.params.id };
  });

  // ---------------------------------------------------------------- admin
  app.register(async (admin) => {
    admin.addHook("preHandler", async (req) => requireServiceRole(req));

    admin.get<{ Querystring: { page?: string; per_page?: string } }>("/admin/users", async (req) => {
      const per = Math.min(Number(req.query.per_page ?? 50), 1000);
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const rows = await sql`select * from auth.users where deleted_at is null order by created_at limit ${per} offset ${(page - 1) * per}`;
      const [{ count }] = await sql`select count(*)::int as count from auth.users where deleted_at is null`;
      return { users: await Promise.all(rows.map((r) => toPublicUser(r as any))), total: count, aud: "authenticated" };
    });

    admin.post<{ Body: any }>("/admin/users", async (req) => {
      const b = (req.body ?? {}) as any;
      const u = await createUser({
        email: b.email,
        password: b.password,
        phone: b.phone,
        confirmed: !!b.email_confirm,
        userMeta: b.user_metadata,
        appMeta: b.app_metadata,
      });
      return toPublicUser(u);
    });

    admin.get<{ Params: { id: string } }>("/admin/users/:id", async (req) => {
      const u = await getUserById(req.params.id);
      if (!u) throw notFound("User not found", "user_not_found");
      return toPublicUser(u);
    });

    admin.put<{ Params: { id: string }; Body: any }>("/admin/users/:id", async (req) => {
      const b = (req.body ?? {}) as any;
      const id = req.params.id;
      if (!(await getUserById(id))) throw notFound("User not found", "user_not_found");
      if (b.password !== undefined) {
        await sql`update auth.users set encrypted_password = ${await hashPassword(assertPassword(b.password))} where id = ${id}`;
      }
      if (b.email !== undefined) await sql`update auth.users set email = ${normalizeEmail(b.email)} where id = ${id}`;
      if (b.email_confirm === true) await sql`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = ${id}`;
      if (b.phone !== undefined) await sql`update auth.users set phone = ${b.phone} where id = ${id}`;
      if (b.user_metadata) await sql`update auth.users set raw_user_meta_data = raw_user_meta_data || ${sql.json(b.user_metadata)} where id = ${id}`;
      if (b.app_metadata) await sql`update auth.users set raw_app_meta_data = raw_app_meta_data || ${sql.json(b.app_metadata)} where id = ${id}`;
      if (b.ban_duration !== undefined) {
        const until = b.ban_duration === "none" ? null : new Date(Date.now() + parseDuration(String(b.ban_duration)));
        await sql`update auth.users set banned_until = ${until} where id = ${id}`;
        if (until) await endSessions(id, undefined, "global");
      }
      await sql`update auth.users set updated_at = now() where id = ${id}`;
      return toPublicUser((await getUserById(id))!);
    });

    admin.delete<{ Params: { id: string } }>("/admin/users/:id", async (req) => {
      await sql`delete from auth.users where id = ${req.params.id}`;
      return {};
    });

    admin.post<{ Body: any }>("/admin/generate_link", async (req) => {
      const { type, email, password, redirect_to, data } = (req.body ?? {}) as any;
      const addr = normalizeEmail(email);
      let u = await getUserByEmail(addr);
      if (!u) {
        if (type !== "signup" && type !== "invite" && type !== "magiclink") throw notFound("User not found", "user_not_found");
        u = await createUser({ email: addr, password, userMeta: data, invited: type === "invite" });
      }
      const ottType: OttType = type === "email_change_current" || type === "email_change_new" ? "email_change" : type;
      const { tokenHash, otp } = await createOneTimeToken(u.id, ottType);
      const link = verifyLink(tokenHash, ottType, safeRedirect(redirect_to));
      return {
        ...(await toPublicUser(u)),
        user: await toPublicUser(u),
        action_link: link,
        email_otp: otp,
        hashed_token: tokenHash,
        redirect_to: safeRedirect(redirect_to),
        verification_type: ottType,
        properties: { action_link: link, email_otp: otp, hashed_token: tokenHash, redirect_to: safeRedirect(redirect_to), verification_type: ottType },
      };
    });

    admin.post<{ Body: any }>("/admin/invite", async (req) => {
      const { email, redirect_to, data } = (req.body ?? {}) as any;
      const u = await createUser({ email, userMeta: data, invited: true });
      const { tokenHash } = await createOneTimeToken(u.id, "invite");
      await sendAuthEmail("invite", u.email!, { url: verifyLink(tokenHash, "invite", safeRedirect(redirect_to)) });
      return toPublicUser(u);
    });
  });
}

function parseDuration(s: string): number {
  const m = /^(\d+)(h|m|s)$/.exec(s);
  if (!m) return 876_000 * 3_600_000; // "forever"
  const n = Number(m[1]);
  return n * (m[2] === "h" ? 3_600_000 : m[2] === "m" ? 60_000 : 1000);
}
