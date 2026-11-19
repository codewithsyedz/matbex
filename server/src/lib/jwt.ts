import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { config } from "../config.js";

const key = new TextEncoder().encode(config.JWT_SECRET);
export const ISSUER = `${config.API_URL}/auth/v1`;

export interface AccessClaims extends JWTPayload {
  sub: string;
  role: "authenticated" | "anon" | "service_role";
  aud: string;
  email?: string;
  phone?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  aal?: "aal1" | "aal2";
  amr?: { method: string; timestamp: number }[];
  session_id?: string;
  is_anonymous?: boolean;
}

export async function sign(payload: Record<string, unknown>, expiresInSeconds: number | null): Promise<string> {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuedAt();
  if (expiresInSeconds !== null) jwt.setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds);
  return jwt.sign(key);
}

/** Verifies any token we issued (user access tokens, service/anon keys, signed URLs). */
export async function verify<T = AccessClaims>(token: string): Promise<T> {
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  return payload as T;
}

export function bearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

/** Claims for the request: verified JWT, or anon when no token. Throws on bad token. */
export async function claimsFromHeader(header: string | undefined | null): Promise<AccessClaims> {
  const token = bearer(header);
  if (!token) return { role: "anon", sub: "", aud: "anon" } as AccessClaims;
  return verify(token);
}
