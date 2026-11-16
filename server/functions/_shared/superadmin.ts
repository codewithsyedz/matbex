import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";
import { hasValidCronSecret } from "./cronSecret.ts";

const API_URL = env("API_URL")!;
const ANON_KEY = env("ANON_KEY")!;
const SERVICE_ROLE_KEY = env("SERVICE_ROLE_KEY")!;

export interface SuperAdminCaller {
  userId: string;
  email: string | null;
  /** Source of truth used to authorise the request. */
  source: "jwt_claim" | "db";
}

/**
 * Verifies that the request comes from a SuperAdmin.
 *
 * Order of checks:
 *   1. Verify the JWT signature via `db.auth.getClaims()` (cheap, in-process).
 *   2. Trust the `app_metadata.is_superadmin` claim if present (kept in sync
 *      by a DB trigger on `public.superadmin_users`).
 *   3. Fall back to a service-role lookup against `superadmin_users` so a
 *      stale JWT can never grant access that's been revoked in the DB.
 *
 * Throws on failure so callers can `try { ... } catch` once.
 */
export async function requireSuperAdmin(req: Request): Promise<SuperAdminCaller> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "Missing authorization header" }), { status: 401 });
  }
  const token = authHeader.slice("Bearer ".length);

  const db = createClient(API_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: claimsData, error: claimsError } = await db.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) {
    throw new Response(JSON.stringify({ error: "Unauthorized - invalid token" }), { status: 401 });
  }
  const userId = claimsData.claims.sub as string;
  const email = (claimsData.claims.email as string | undefined) ?? null;

  // SuperAdmin rights need a session that passed two-factor (aal2), as is_superadmin() requires.
  if (claimsData.claims.aal !== "aal2") {
    throw new Response(JSON.stringify({ error: "Two-factor verification required for SuperAdmin access", code: "mfa_required" }), { status: 403 });
  }

  // 1) JWT-embedded claim (fast path)
  const appMeta = (claimsData.claims.app_metadata ?? {}) as Record<string, unknown>;
  if (appMeta.is_superadmin === true) {
    // Re-confirm against DB so a revoked SuperAdmin with a still-valid JWT
    // cannot continue using privileged endpoints.
    const ok = await dbIsSuperAdmin(userId);
    if (ok) return { userId, email, source: "jwt_claim" };
    throw new Response(JSON.stringify({ error: "SuperAdmin access revoked" }), { status: 403 });
  }

  // 2) DB fallback - covers tokens issued before the trigger was installed.
  const ok = await dbIsSuperAdmin(userId);
  if (!ok) {
    throw new Response(JSON.stringify({ error: "Requires SuperAdmin privileges" }), { status: 403 });
  }
  return { userId, email, source: "db" };
}

/** The two-factor level of the request's (already verified) access token: "aal1" or "aal2". */
export function requestAal(req: Request): string {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  try {
    const part = token.split(".")[1] ?? "";
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json.aal === "string" ? json.aal : "aal1";
  } catch {
    return "aal1";
  }
}

/**
 * SuperAdmin rights for this request: the user is a superadmin AND the session passed two-factor.
 * Use this instead of reading superadmin_users / is_superadmin with the service client, which
 * cannot see the session's two-factor level. Call only after the token was verified.
 */
export async function isSuperAdminSession(req: Request, userId: string): Promise<boolean> {
  if (requestAal(req) !== "aal2") return false;
  return dbIsSuperAdmin(userId);
}

async function dbIsSuperAdmin(userId: string): Promise<boolean> {
  const admin = createClient(API_URL, SERVICE_ROLE_KEY);
  const { data, error } = await admin.rpc("is_superadmin", { _user_id: userId });
  if (error) {
    console.error("dbIsSuperAdmin RPC failed:", error);
    return false;
  }
  return data === true;
}

/**
 * For functions that are normally invoked by a scheduled job (cron) but should
 * still be callable by a SuperAdmin on-demand. Accepts either:
 *   - `x-cron-secret` header matching the CRON_SECRET env var, OR
 *   - a valid SuperAdmin JWT (via `requireSuperAdmin`).
 * Throws a Response on failure.
 */
export async function requireSuperAdminOrCron(
  req: Request,
): Promise<{ source: "cron" | "jwt_claim" | "db"; userId?: string; email?: string | null }> {
  if (await hasValidCronSecret(req)) {
    return { source: "cron" };
  }
  const caller = await requireSuperAdmin(req);
  return { source: caller.source, userId: caller.userId, email: caller.email };
}