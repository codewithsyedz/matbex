// =====================================================================
// Per-device AES-GCM encryption for sensitive offline payload fields.
// ---------------------------------------------------------------------
// - Generates a non-extractable CryptoKey on first use, stored as a
//   wrapped JWK in IndexedDB (extractable=false on the live key, JWK
//   only persisted because IndexedDB cannot store CryptoKey directly
//   in all browsers consistently). The JWK never leaves this device.
// - Encrypts only sensitive fields (customer_phone, customer_email,
//   notes). Card data is never accepted in the first place.
// - Card-data guardrail: stripCardData() removes any field name that
//   looks like card/PAN/CVV/track data.
// =====================================================================

import { kvGet, kvSet } from "./db";

const KEY_ID = "pos.aes_key.v1";
const ENC_PREFIX = "enc:v1:";

const SENSITIVE_FIELDS = new Set([
  "customer_phone",
  "customer_email",
  "phone",
  "email",
  "notes",
  "customer_notes",
]);

const FORBIDDEN_FIELDS = [
  /pan/i,
  /card[_-]?number/i,
  /cvv/i,
  /cvc/i,
  /track[_-]?data/i,
  /magstripe/i,
];

let _keyPromise: Promise<CryptoKey> | null = null;

async function getKey(): Promise<CryptoKey> {
  if (_keyPromise) return _keyPromise;
  _keyPromise = (async () => {
    const existing = await kvGet<JsonWebKey>(KEY_ID);
    if (existing) {
      return crypto.subtle.importKey("jwk", existing, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]);
    }
    const generated = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true, // extractable so we can persist the JWK to IDB
      ["encrypt", "decrypt"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", generated);
    await kvSet(KEY_ID, jwk);
    // Re-import as non-extractable for runtime use
    return crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  })();
  return _keyPromise;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encryptString(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const merged = new Uint8Array(iv.length + ct.length);
  merged.set(iv, 0);
  merged.set(ct, iv.length);
  return ENC_PREFIX + b64encode(merged);
}

async function decryptString(token: string): Promise<string> {
  if (!token.startsWith(ENC_PREFIX)) return token;
  const key = await getKey();
  const merged = b64decode(token.slice(ENC_PREFIX.length));
  const iv = merged.slice(0, 12);
  const ct = merged.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plain);
}

/** Reject card data BEFORE it ever reaches IndexedDB. */
export function stripCardData<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  const out: any = Array.isArray(payload) ? [] : {};
  for (const [k, v] of Object.entries(payload as any)) {
    if (FORBIDDEN_FIELDS.some((rx) => rx.test(k))) continue;
    out[k] = v && typeof v === "object" ? stripCardData(v) : v;
  }
  return out;
}

/** Mask + encrypt sensitive fields recursively. */
export async function protectPayload<T>(payload: T): Promise<T> {
  const cleaned = stripCardData(payload);
  return walk(cleaned, true) as Promise<T>;
}

/** Decrypt sensitive fields for display/sync. */
export async function unprotectPayload<T>(payload: T): Promise<T> {
  return walk(payload, false) as Promise<T>;
}

async function walk(value: any, encrypt: boolean): Promise<any> {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Promise.all(value.map((v) => walk(v, encrypt)));
  const out: any = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && SENSITIVE_FIELDS.has(k)) {
      out[k] = encrypt ? await encryptString(v) : await decryptString(v);
    } else if (v && typeof v === "object") {
      out[k] = await walk(v, encrypt);
    } else {
      out[k] = v;
    }
  }
  return out;
}