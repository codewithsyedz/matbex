/**
 * Request-level security rules shared by the data API gateway, the functions host and /api/v1:
 *  - the caller's IP (from the proxy chain, never from the client) is passed to Postgres as
 *    x-matbex-client-ip / the x_client_ip claim, for the SuperAdmin IP allow-list
 *    (public.admin_ip_allowed, used by is_superadmin);
 *  - owners of paying businesses must use a two-factor (aal2) session once
 *    security.owner_mfa_required is on (public.owner_mfa_required). Until then their requests are
 *    refused, except what the app needs to show the two-factor screen.
 */
import { sql } from "../db.js";
import { bearer, verify, type AccessClaims } from "./jwt.js";

export const CLIENT_IP_HEADER = "x-matbex-client-ip";
export const MFA_REQUIRED = { code: "mfa_required", message: "Two-factor verification is required for business owners. Open the app to verify." };

/**
 * The IP to hand to Postgres, or null for internal callers. Public traffic always arrives through
 * Caddy, which sets the real client address; a private address means another service here (a
 * server function calling the data API) or local development, which the allow-list does not cover.
 */
export function publicClientIp(ip: string | undefined): string | null {
  const a = (ip ?? "").replace(/^::ffff:/i, "");
  if (!a || a === "::1" || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) || /^f[cd]/i.test(a)) return null;
  return a;
}

const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expires: number }>();

/** True when this caller must verify with two-factor before using the business's data. */
export async function ownerMfaBlocked(claims: Partial<AccessClaims> | null | undefined): Promise<boolean> {
  if (!claims || claims.role !== "authenticated" || !claims.sub || claims.aal === "aal2") return false;
  const sub = String(claims.sub);
  const hit = cache.get(sub);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value = false;
  try {
    const [row] = await sql<{ required: boolean }[]>`select public.owner_mfa_required(${sub}::uuid) as required`;
    value = row?.required === true;
  } catch {
    value = false; // never lock people out because the check itself failed
  }
  cache.set(sub, { value, expires: Date.now() + TTL_MS });
  if (cache.size > 5000) for (const [k, v] of cache) if (v.expires < Date.now()) cache.delete(k);
  return value;
}

/** The verified claims of an Authorization header, or null (no token / anon key / invalid). */
export async function userClaims(header: string | undefined | null): Promise<AccessClaims | null> {
  const token = bearer(header);
  if (!token) return null;
  try {
    const claims = await verify(token);
    return claims.role === "authenticated" ? claims : null;
  } catch {
    return null;
  }
}

/**
 * Data API paths an owner who still has to verify may use: reads the app needs to know who they
 * are and show the two-factor screen. Everything else waits for the code.
 */
const MFA_PENDING_READS = new Set(["profiles", "user_tenant_roles", "user_roles", "tenants", "plans", "restaurants", "platform_features", "platform_announcements"]);
const MFA_PENDING_RPCS = new Set(["session_security_status", "superadmin_mfa_status", "tenant_entitlements", "get_feature_flags_for_tenant", "active_announcements"]);

export function allowedWhileMfaPending(method: string, path: string): boolean {
  const [first, second] = path.split("?")[0].split("/");
  if (first === "rpc") return MFA_PENDING_RPCS.has(second ?? "");
  return (method === "GET" || method === "HEAD") && MFA_PENDING_READS.has(first ?? "");
}
