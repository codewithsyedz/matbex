#!/usr/bin/env node
/**
 * Generates JWT_SECRET plus long-lived ANON_KEY / SERVICE_ROLE_KEY tokens signed with it.
 *   node scripts/generate-keys.mjs            → new secret + keys
 *   JWT_SECRET=... node scripts/generate-keys.mjs  → keys for an existing secret
 * Paste the output into your .env. Rotating JWT_SECRET signs everyone out.
 */
import { SignJWT } from "jose";
import { randomBytes } from "node:crypto";

const secret = process.env.JWT_SECRET ?? randomBytes(48).toString("base64url");
const key = new TextEncoder().encode(secret);
const tenYears = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
const mk = (role) =>
  new SignJWT({ role, iss: "matbex" }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuedAt().setExpirationTime(tenYears).sign(key);

console.log(`JWT_SECRET=${secret}`);
console.log(`ANON_KEY=${await mk("anon")}`);
console.log(`SERVICE_ROLE_KEY=${await mk("service_role")}`);
console.log(`AUTHENTICATOR_PASSWORD=${randomBytes(24).toString("base64url")}`);
console.log(`CRON_SECRET=${randomBytes(24).toString("hex")}`);
