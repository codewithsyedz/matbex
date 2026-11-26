// Deliverect (POS integration): Matbex is the POS; Deliverect relays orders from Jahez,
// HungerStation, Keeta... Docs: https://developers.deliverect.com (POS register, order webhook,
// /orderStatus, /updateStoreStatus, OAuth client credentials, HMAC on webhooks).
//
// Server settings (Matbex's partner credentials, not per restaurant):
//   DELIVERECT_ENV              staging | production (default staging)
//   DELIVERECT_CLIENT_ID / DELIVERECT_CLIENT_SECRET   OAuth client credentials
//   DELIVERECT_WEBHOOK_SECRET   production HMAC secret (Integration settings)
//   DELIVERECT_PRODUCTS_PATH    product upload path (default /productAndCategories; confirm with
//                               Deliverect when partner access is granted)

import { env } from "../_runtime/env.ts";
import { hasFeature } from "./entitlements.ts";

export const deliverectEnv = () => (env("DELIVERECT_ENV") === "production" ? "production" : "staging");
export const deliverectBase = () =>
  deliverectEnv() === "production" ? "https://api.deliverect.com" : "https://api.staging.deliverect.com";

// ---- entitlement --------------------------------------------------------------------------

/**
 * Delivery Aggregators is an Enterprise feature (feature_flags 'aggregators_enabled', min_plan);
 * same resolution as the app's useFeatureFlag: disabled list wins, rollout list overrides the plan.
 */
// deno-lint-ignore no-explicit-any
export async function aggregatorsAllowed(db: any, tenantId: string): Promise<boolean> {
  // The delivery-apps rollout flag (aggregators_enabled: Enterprise) from the shared entitlement map.
  return hasFeature(db, tenantId, "aggregators_enabled");
}

// ---- webhook signatures ------------------------------------------------------------------

async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Deliverect signs the raw body with HMAC-SHA256 (hex) in X-Server-Authorization-HMAC-SHA256.
 * Production: the partner secret. Staging only: Deliverect uses the location id or the channel
 * link as the secret, so those (taken from the body) are also accepted there.
 */
export async function verifyDeliverectSignature(rawBody: string, header: string | null, stagingKeys: (string | null | undefined)[] = []): Promise<boolean> {
  if (!header) return false;
  const received = header.replace(/^sha256=/i, "").trim().toLowerCase();
  const secrets = [env("DELIVERECT_WEBHOOK_SECRET")];
  if (deliverectEnv() === "staging") secrets.push(...stagingKeys);
  for (const s of secrets) {
    if (s && sameHex(received, await hmacHex(s, rawBody))) return true;
  }
  return false;
}

export const signForTest = hmacHex;

// ---- API calls ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60 > Date.now() / 1000) return cachedToken.token;
  const clientId = env("DELIVERECT_CLIENT_ID");
  const clientSecret = env("DELIVERECT_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Deliverect is not set up on this server (DELIVERECT_CLIENT_ID / _SECRET)");
  const res = await fetch(`${deliverectBase()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, audience: deliverectBase(), grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Deliverect login failed (${res.status})`);
  cachedToken = { token: body.access_token, expiresAt: Number(body.expires_at) || Date.now() / 1000 + Number(body.expires_in || 3600) };
  return cachedToken.token;
}

export async function deliverectPost(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${deliverectBase()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* plain text */ }
  if (res.status === 401) cachedToken = null;
  return { status: res.status, body };
}

// ---- menu ----------------------------------------------------------------------------------

export interface MenuItemRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  image_url: string | null;
  is_active: boolean | null;
  selling_price: number | null;
  quarter_price: number | null;
  half_price: number | null;
  full_price: number | null;
}

const SIZE_LABEL: Record<string, string> = { quarter: "Quarter", half: "Half", full: "Full" };
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9؀-ۿ]+/gi, "-").replace(/^-|-$/g, "") || "menu";

/**
 * Matbex menu -> Deliverect products and categories. One product per item, or per size when the
 * item has quarter/half/full prices; plu "<menu_item_id>" or "<menu_item_id>:<size>" (orders come
 * back with that plu). Prices are VAT-inclusive halalas; taxes in thousandths of a percent.
 */
export function buildDeliverectMenu(items: MenuItemRow[], vatRate: number) {
  const tax = Math.round((vatRate > 1 ? vatRate / 100 : vatRate) * 100 * 1000);
  const cats = new Map<string, string>();
  const products: Record<string, unknown>[] = [];
  for (const m of items) {
    if (m.is_active === false) continue;
    const catName = (m.category ?? "").trim() || "Menu";
    const catId = slug(catName);
    cats.set(catId, catName);
    const base = {
      productType: 1,
      posCategoryIds: [catId],
      description: m.description ?? "",
      imageUrl: m.image_url ?? undefined,
      deliveryTax: tax,
      takeawayTax: tax,
      eatInTax: tax,
      min: 0,
      max: 0,
      visible: true,
    };
    const sizes = (["quarter", "half", "full"] as const).filter((s) => Number(m[`${s}_price`]) > 0);
    if (sizes.length > 1) {
      for (const s of sizes) {
        products.push({ ...base, plu: `${m.id}:${s}`, posProductId: `${m.id}:${s}`, name: `${m.name} (${SIZE_LABEL[s]})`, price: Math.round(Number(m[`${s}_price`]) * 100) });
      }
    } else {
      const price = Number(m.selling_price) > 0 ? Number(m.selling_price) : Number(m[`${sizes[0] ?? "full"}_price`] ?? 0);
      if (!(price > 0)) continue;
      products.push({ ...base, plu: m.id, posProductId: m.id, name: m.name, price: Math.round(price * 100) });
    }
  }
  return { products, categories: [...cats].map(([posCategoryId, name]) => ({ posCategoryId, name })) };
}
