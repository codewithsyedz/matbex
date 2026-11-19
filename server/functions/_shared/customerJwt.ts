import { env } from "../_runtime/env.ts";
// Minimal HS256 JWT for customer sessions (Deno / Edge runtime).
// Secret is loaded from the platform_settings table (key = customer_jwt_secret).

import { createClient } from "@matbex/client";

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 ? 4 - (str.length % 4) : 0;
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

let cachedSecret: { value: string; at: number } | null = null;

export async function getCustomerJwtSecret(): Promise<string> {
  if (cachedSecret && Date.now() - cachedSecret.at < 60_000) return cachedSecret.value;
  const admin = createClient(
    env("API_URL")!,
    env("SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin
    .from("platform_settings")
    .select("value")
    .eq("key", "customer_jwt_secret")
    .maybeSingle();
  if (error) throw new Error(`Failed to load JWT secret: ${error.message}`);
  const secret = (data?.value as any)?.secret;
  if (!secret || typeof secret !== "string" || secret.length < 32) {
    throw new Error("Customer JWT signing secret is not configured");
  }
  cachedSecret = { value: secret, at: Date.now() };
  return secret;
}

export async function getTwilioFromNumber(): Promise<string> {
  const admin = createClient(
    env("API_URL")!,
    env("SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin
    .from("platform_settings")
    .select("value")
    .eq("key", "customer_otp_from_number")
    .maybeSingle();
  if (error) throw new Error(`Failed to load From number: ${error.message}`);
  const number = (data?.value as any)?.number;
  if (!number) throw new Error("SMS From number is not configured");
  return number;
}

export interface SmsProviderSettings {
  primary: "twilio" | "unifonic";
  secondary: "twilio" | "unifonic" | "none";
  twilio?: { from?: string };
  unifonic?: { app_sid?: string; sender_id?: string };
}

export async function getSmsProviderSettings(): Promise<SmsProviderSettings> {
  const admin = createClient(
    env("API_URL")!,
    env("SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin
    .from("platform_settings")
    .select("key, value")
    .in("key", ["sms_provider", "customer_otp_from_number", "unifonic_settings"]);
  if (error) throw new Error(`Failed to load SMS settings: ${error.message}`);
  const map: Record<string, any> = {};
  for (const row of (data ?? []) as any[]) map[row.key] = row.value ?? {};
  const sp = map.sms_provider ?? {};
  // Backward compatible with old shape { provider }
  const primary = (sp.primary ?? sp.provider ?? "unifonic") as "twilio" | "unifonic";
  const secondary = (sp.secondary ?? "none") as "twilio" | "unifonic" | "none";
  return {
    primary,
    secondary,
    twilio: { from: map.customer_otp_from_number?.number },
    unifonic: {
      app_sid: map.unifonic_settings?.app_sid,
      sender_id: map.unifonic_settings?.sender_id,
    },
  };
}

export interface CustomerClaims {
  sub: string; // customer_profiles.id
  phone: string;
  iat: number;
  exp: number;
}

export async function signCustomerJwt(
  payload: Omit<CustomerClaims, "iat" | "exp">,
  ttlSeconds = 60 * 60 * 24 * 30, // 30 days
): Promise<string> {
  const secret = await getCustomerJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const claims: CustomerClaims = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = { alg: "HS256", typ: "JWT" };
  const enc = new TextEncoder();
  const h = b64urlEncode(enc.encode(JSON.stringify(header)));
  const p = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const data = `${h}.${p}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyCustomerJwt(token: string): Promise<CustomerClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [h, p, s] = parts;
  const secret = await getCustomerJwtSecret();
  const key = await hmacKey(secret);
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = b64urlDecode(s);
  const ok = await crypto.subtle.verify("HMAC", key, sig as BufferSource, data);
  if (!ok) throw new Error("Invalid signature");
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as CustomerClaims;
  if (claims.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
  return claims;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizePhone(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, "");
  if (!/^\+[1-9][0-9]{6,14}$/.test(t)) return null;
  return t;
}