// Deliverect / Otter (and Jahez, HungerStation, Keeta, ToYou, Mrsool, Careem, Talabat)
// webhook receiver. Validates per-provider HMAC, normalizes the payload, and
// upserts into public.delivery_orders.
//
// URL pattern: POST /functions/v1/delivery-webhook/{provider}
//   provider ∈ deliverect | otter | jahez | hungerstation | keeta | toyou | mrsool | careem | talabat
//
// Each provider's shared secret is stored under <PROVIDER>_WEBHOOK_SECRET
// (e.g. DELIVERECT_WEBHOOK_SECRET, OTTER_WEBHOOK_SECRET).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

type Provider =
  | "deliverect"
  | "otter"
  | "jahez"
  | "hungerstation"
  | "keeta"
  | "toyou"
  | "mrsool"
  | "careem"
  | "talabat";

const PROVIDERS: Provider[] = [
  "deliverect", "otter", "jahez", "hungerstation",
  "keeta", "toyou", "mrsool", "careem", "talabat",
];

interface NormalizedOrder {
  external_order_id: string;
  external_location_id: string;
  display_id?: string | null;
  channel?: string | null;
  status: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: unknown[];
  subtotal: number;
  tax: number;
  delivery_fee: number;
  discount: number;
  total: number;
  currency: string;
  order_type?: string | null;
  scheduled_at?: string | null;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? Number(n) : fallback;
}

/** Deliverect order status → internal status. */
const DELIVERECT_STATUS: Record<number, string> = {
  10: "received",
  20: "received",
  50: "accepted",
  60: "preparing",
  70: "ready",
  90: "dispatched",
  100: "delivered",
  110: "cancelled",
  900: "failed",
};

function normalizeDeliverect(p: any): NormalizedOrder {
  const items = Array.isArray(p?.items) ? p.items : [];
  return {
    external_order_id: String(p?._id ?? p?.id ?? p?.orderId ?? ""),
    external_location_id: String(p?.location ?? p?.locationId ?? p?.channelLocationId ?? ""),
    display_id: p?.orderDisplayId ?? p?.channelOrderDisplayId ?? null,
    channel: p?.channel ?? p?.channelName ?? null,
    status: DELIVERECT_STATUS[Number(p?.status)] ?? "received",
    customer_name: p?.customer?.name ?? null,
    customer_phone: p?.customer?.phone ?? null,
    items,
    subtotal: num(p?.payment?.subtotal ?? p?.subTotal) / 100,
    tax: num(p?.payment?.tax) / 100,
    delivery_fee: num(p?.payment?.delivery ?? p?.deliveryCost) / 100,
    discount: num(p?.payment?.discount ?? p?.discountTotal) / 100,
    total: num(p?.payment?.total ?? p?.total) / 100,
    currency: p?.payment?.currency ?? "SAR",
    order_type: p?.orderType ?? null,
    scheduled_at: p?.pickupTime ?? p?.deliveryTime ?? null,
  };
}

function normalizeOtter(p: any): NormalizedOrder {
  const order = p?.order ?? p;
  const items = Array.isArray(order?.items) ? order.items : [];
  return {
    external_order_id: String(order?.id ?? order?.orderId ?? ""),
    external_location_id: String(order?.storeId ?? order?.store?.id ?? order?.location?.id ?? ""),
    display_id: order?.externalId ?? order?.displayId ?? null,
    channel: order?.brand ?? order?.platform ?? null,
    status: String(order?.state ?? order?.status ?? "received").toLowerCase(),
    customer_name: order?.customer?.firstName
      ? `${order.customer.firstName} ${order.customer.lastName ?? ""}`.trim()
      : order?.customer?.name ?? null,
    customer_phone: order?.customer?.phone ?? null,
    items,
    subtotal: num(order?.totals?.subtotal),
    tax: num(order?.totals?.tax),
    delivery_fee: num(order?.totals?.deliveryFee),
    discount: num(order?.totals?.discount),
    total: num(order?.totals?.total ?? order?.total),
    currency: order?.totals?.currency ?? "SAR",
    order_type: order?.fulfillment?.type ?? null,
    scheduled_at: order?.fulfillment?.scheduledAt ?? null,
  };
}

/** Generic fallback for direct aggregators (Jahez/HungerStation/Keeta/etc.). */
function normalizeGeneric(p: any): NormalizedOrder {
  const o = p?.order ?? p;
  return {
    external_order_id: String(o?.order_id ?? o?.id ?? o?.reference ?? ""),
    external_location_id: String(o?.branch_id ?? o?.store_id ?? o?.location_id ?? ""),
    display_id: o?.display_id ?? o?.code ?? null,
    channel: o?.channel ?? null,
    status: String(o?.status ?? "received").toLowerCase(),
    customer_name: o?.customer?.name ?? null,
    customer_phone: o?.customer?.phone ?? null,
    items: Array.isArray(o?.items) ? o.items : [],
    subtotal: num(o?.subtotal),
    tax: num(o?.tax ?? o?.vat),
    delivery_fee: num(o?.delivery_fee),
    discount: num(o?.discount),
    total: num(o?.total ?? o?.amount),
    currency: o?.currency ?? "SAR",
    order_type: o?.type ?? null,
    scheduled_at: o?.scheduled_at ?? null,
  };
}

function normalize(provider: Provider, payload: any): NormalizedOrder {
  switch (provider) {
    case "deliverect":
      return normalizeDeliverect(payload);
    case "otter":
      return normalizeOtter(payload);
    default:
      return normalizeGeneric(payload);
  }
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Extract a hex HMAC from common header variants (strips prefixes like "sha256="). */
function extractSignature(req: Request): string | null {
  const candidates = [
    "x-deliverect-signature",
    "x-otter-signature",
    "x-webhook-signature",
    "x-signature",
    "x-hub-signature-256",
  ];
  for (const h of candidates) {
    const v = req.headers.get(h);
    if (v) return v.replace(/^sha256=/i, "").trim().toLowerCase();
  }
  return null;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  // path looks like /delivery-webhook/<provider> when invoked through Supabase
  const provider = url.pathname.split("/").filter(Boolean).pop() as Provider;

  if (!PROVIDERS.includes(provider)) {
    return new Response(
      JSON.stringify({ error: `Unknown provider. Use one of: ${PROVIDERS.join(", ")}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const secret = Deno.env.get(`${provider.toUpperCase()}_WEBHOOK_SECRET`);

  let signatureValid: boolean | null = null;
  if (secret) {
    const received = extractSignature(req);
    if (!received) {
      return new Response(JSON.stringify({ error: "Missing signature header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const expected = await hmacSha256Hex(secret, rawBody);
    signatureValid = timingSafeEqual(received, expected);
    if (!signatureValid) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else {
    console.warn(`[delivery-webhook] ${provider}: no shared secret configured — accepting without HMAC verification`);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let normalized: NormalizedOrder;
  try {
    normalized = normalize(provider, payload);
  } catch (e) {
    return new Response(JSON.stringify({ error: `Normalization failed: ${e instanceof Error ? e.message : String(e)}` }), {
      status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!normalized.external_order_id || !normalized.external_location_id) {
    return new Response(
      JSON.stringify({ error: "Payload missing external_order_id or external_location_id" }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve restaurant via provider + external location ID mapping.
  const { data: mapping, error: mapErr } = await supabase
    .from("delivery_platform_locations")
    .select("tenant_id, restaurant_id, is_active")
    .eq("provider", provider)
    .eq("external_location_id", normalized.external_location_id)
    .maybeSingle();

  if (mapErr) {
    console.error("[delivery-webhook] location lookup failed", mapErr);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!mapping || !mapping.is_active) {
    // Acknowledge with 202 so the provider does not retry forever, but log for ops.
    console.warn(
      `[delivery-webhook] no active mapping for ${provider}/${normalized.external_location_id} — order ${normalized.external_order_id} dropped`,
    );
    return new Response(
      JSON.stringify({ ok: false, reason: "no_location_mapping" }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const row = {
    tenant_id: mapping.tenant_id,
    restaurant_id: mapping.restaurant_id,
    provider,
    channel: normalized.channel,
    external_order_id: normalized.external_order_id,
    external_location_id: normalized.external_location_id,
    display_id: normalized.display_id,
    status: normalized.status,
    customer_name: normalized.customer_name,
    customer_phone: normalized.customer_phone,
    items: normalized.items,
    subtotal: normalized.subtotal,
    tax: normalized.tax,
    delivery_fee: normalized.delivery_fee,
    discount: normalized.discount,
    total: normalized.total,
    currency: normalized.currency,
    order_type: normalized.order_type,
    scheduled_at: normalized.scheduled_at,
    raw_payload: payload,
    signature_valid: signatureValid,
    cancelled_at: normalized.status === "cancelled" ? new Date().toISOString() : null,
  };

  // Upsert so retries from the provider are idempotent.
  const { data: upserted, error: upErr } = await supabase
    .from("delivery_orders")
    .upsert(row, { onConflict: "provider,external_order_id" })
    .select("id")
    .single();

  if (upErr) {
    console.error("[delivery-webhook] upsert failed", upErr);
    return new Response(JSON.stringify({ error: "Persist failed", detail: upErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Bridge to unified online_orders queue for the 4 KSA aggregators (HungerStation, Jahez, Mrsool, Talabat)
  // when a tenant has enabled the channel in aggregator_credentials. Idempotent on (restaurant_id, channel, external_order_id).
  const BRIDGE_CHANNELS = new Set(["hungerstation", "jahez", "mrsool", "talabat"]);
  if (BRIDGE_CHANNELS.has(provider) && normalized.status !== "cancelled") {
    try {
      const { data: cred } = await supabase
        .from("aggregator_credentials")
        .select("enabled")
        .eq("restaurant_id", mapping.restaurant_id)
        .eq("aggregator", provider)
        .maybeSingle();

      if (cred?.enabled) {
        // Get next order number for this restaurant
        const { data: lastOrder } = await supabase
          .from("online_orders")
          .select("order_number")
          .eq("restaurant_id", mapping.restaurant_id)
          .order("order_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        const nextOrderNumber = (lastOrder?.order_number ?? 0) + 1;

        await supabase.from("online_orders").upsert({
          restaurant_id: mapping.restaurant_id,
          order_number: nextOrderNumber,
          channel: provider,
          external_order_id: normalized.external_order_id,
          external_payload: payload,
          customer_name: normalized.customer_name ?? "Guest",
          customer_phone: normalized.customer_phone ?? "",
          subtotal: normalized.subtotal,
          tax: normalized.tax,
          delivery_fee: normalized.delivery_fee,
          total: normalized.total,
          order_type: normalized.order_type ?? "delivery",
          payment_status: "paid",
          payment_method: "aggregator",
          status: normalized.status === "received" ? "pending" : normalized.status,
        }, { onConflict: "restaurant_id,channel,external_order_id", ignoreDuplicates: true });

        await supabase.from("aggregator_webhook_logs").insert({
          restaurant_id: mapping.restaurant_id,
          aggregator: provider,
          store_id: normalized.external_location_id,
          status: "bridged",
          http_status: 200,
          external_order_id: normalized.external_order_id,
        });
      }
    } catch (bridgeErr) {
      console.error("[delivery-webhook] bridge to online_orders failed", bridgeErr);
      // Non-fatal: delivery_orders persisted successfully
    }
  }

  return new Response(
    JSON.stringify({ ok: true, id: upserted?.id, provider, status: normalized.status }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});