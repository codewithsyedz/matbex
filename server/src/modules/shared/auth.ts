/** Caller identity for /api/v1 modules: a verified user access token is required. */
import type { FastifyRequest } from "fastify";
import type { DbClaims } from "../../db.js";
import { unauthorized } from "../../lib/errors.js";
import { claimsFromHeader } from "../../lib/jwt.js";

export async function requireUser(req: FastifyRequest): Promise<DbClaims & { sub: string }> {
  let claims: DbClaims;
  try {
    claims = (await claimsFromHeader(req.headers.authorization)) as unknown as DbClaims;
  } catch {
    throw unauthorized("Invalid or expired token", "bad_jwt");
  }
  if (claims.role !== "authenticated" || !claims.sub) throw unauthorized("Sign in required", "no_user");
  return claims as DbClaims & { sub: string };
}
