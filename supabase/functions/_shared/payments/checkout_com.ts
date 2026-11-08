// Checkout.com adapter. Implements PaymentAdapter using the Unified Payments API.
// https://www.checkout.com/docs/payments/accept-payments
//
// Supported methods:
//   - mada / visa / mastercard via Hosted Payments Page (token source created
//     on the HPP). For card flows we use the Payment Sessions / Hosted Payments
//     Page redirect — never collect PAN server-side.
//   - apple_pay, stc_pay, tamara, tabby via APM source types on the Hosted
//     Payments Page.
//
// Credentials (per-tenant rows in payment_gateway_credentials, or env fallback):
//   CKO_SECRET_KEY             - sk_... bearer token (server-side)
//   CKO_PUBLIC_KEY             - pk_... (returned to client if needed)
//   CKO_PROCESSING_CHANNEL_ID  - pc_...
//   CKO_WEBHOOK_SECRET         - HMAC signing key for cko-signature verification
//   CKO_ENVIRONMENT            - "sandbox" (default) or "production"

import {
  CreateIntentInput,
  CreateIntentResult,
  GatewayCredentials,
  NormalizedStatus,
  PaymentAdapter,
  RefundResult,
  VerifyResult,
  WebhookResult,
} from "./types.ts";

const HOST_SANDBOX = "https://api.sandbox.checkout.com";
const HOST_LIVE = "https://api.checkout.com";

function host(creds: GatewayCredentials): string {
  return (creds.CKO_ENVIRONMENT ?? "sandbox") === "production"
    ? HOST_LIVE
    : HOST_SANDBOX;
}

function normalize(status: string | undefined): NormalizedStatus {
  switch ((status ?? "").toLowerCase()) {
    case "captured":
    case "paid":
      return "captured";
    case "authorized":
      return "authorized";
    case "pending":
    case "requires_capture":
      return "pending";
    case "expired":
      return "expired";
    case "declined":
    case "canceled":
    case "cancelled":
      return "failed";
    case "refunded":
      return "refunded";
    case "partially_refunded":
      return "partial_refunded";
    default:
      return "pending";
  }
}

function eventStatus(eventType: string | undefined): NormalizedStatus {
  const t = (eventType ?? "").toLowerCase();
  if (t.includes("captured") || t.includes("payment_paid")) return "captured";
  if (t.includes("authorized")) return "authorized";
  if (t.includes("declined") || t.includes("payment_failed")) return "failed";
  if (t.includes("expired")) return "expired";
  if (t.includes("refund")) return "refunded";
  if (t.includes("canceled") || t.includes("cancelled")) return "failed";
  return "pending";
}

/** Map our internal payment method to a Checkout.com source.type. */
function sourceForMethod(method: string): Record<string, unknown> | null {
  switch (method) {
    case "apple_pay":
      return { type: "applepay" };
    case "stc_pay":
      return { type: "stcpay" };
    case "tamara":
      return { type: "tamara" };
    case "tabby":
      return { type: "tabby" };
    case "mada":
    case "visa":
    case "mastercard":
      // Card payments use the Hosted Payments Page form. Source is omitted on
      // session creation and collected on the hosted page.
      return null;
    default:
      return null;
  }
}

async function ckoFetch(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<any> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Checkout.com non-JSON response (${resp.status}): ${text}`);
  }
  if (!resp.ok) {
    const msg =
      data?.error_codes?.join(", ") ??
      data?.message ??
      `HTTP ${resp.status}`;
    throw new Error(`Checkout.com error: ${msg}`);
  }
  return data;
}

async function verifyHmac(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computed.toLowerCase() === signature.toLowerCase();
}

export const checkoutComAdapter: PaymentAdapter = {
  gateway: "checkout_com",

  async createPaymentIntent(
    input: CreateIntentInput,
  ): Promise<CreateIntentResult> {
    const token = input.credentials.CKO_SECRET_KEY;
    if (!token) throw new Error("CKO_SECRET_KEY is not configured");
    const pc = input.credentials.CKO_PROCESSING_CHANNEL_ID;

    // Checkout.com expects minor units (halalas for SAR).
    const amountMinor = Math.round(input.amount * 100);

    const baseBody: Record<string, unknown> = {
      amount: amountMinor,
      currency: "SAR",
      reference: input.idempotencyKey,
      success_url: input.returnUrl
        ? `${input.returnUrl}?cko_status=success`
        : undefined,
      failure_url: input.returnUrl
        ? `${input.returnUrl}?cko_status=failure`
        : undefined,
      metadata: {
        tenant_id: input.tenantId,
        order_id: input.orderId ?? "",
        branch_id: input.branchId ?? "",
        method: input.method,
        ...(input.metadata ?? {}),
      },
    };
    if (pc) baseBody["processing_channel_id"] = pc;

    const apmSource = sourceForMethod(input.method);

    // Card flows → Hosted Payments Page (lets Checkout.com handle 3DS + PAN).
    if (!apmSource) {
      const body = {
        ...baseBody,
        billing: { address: { country: "SA" } },
        // Restrict to Mada when requested
        ...(input.method === "mada"
          ? { payment_method_configuration: { card: { enabled: true } } }
          : {}),
      };
      const data = await ckoFetch(`${host(input.credentials)}/hosted-payments`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        gatewayIntentId: data.id,
        status: "pending",
        redirectUrl: data._links?.redirect?.href ?? data.redirect_url,
        raw: data,
      };
    }

    // APM flow → /payments with source
    const data = await ckoFetch(`${host(input.credentials)}/payments`, token, {
      method: "POST",
      headers: { "Cko-Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ ...baseBody, source: apmSource }),
    });

    return {
      gatewayIntentId: data.id,
      status: normalize(data.status),
      redirectUrl:
        data._links?.redirect?.href ?? data.redirect_url ?? undefined,
      raw: data,
    };
  },

  async verifyPayment(
    gatewayIntentId: string,
    credentials: GatewayCredentials,
  ): Promise<VerifyResult> {
    const token = credentials.CKO_SECRET_KEY;
    if (!token) throw new Error("CKO_SECRET_KEY is not configured");

    // Hosted Payments Page IDs are prefixed `hp_`. For those we fetch the
    // hosted-payment record which exposes the underlying payment id + status.
    if (gatewayIntentId.startsWith("hp_")) {
      const hp = await ckoFetch(
        `${host(credentials)}/hosted-payments/${gatewayIntentId}`,
        token,
      );
      const paymentId = hp?.payment_id ?? hp?.id;
      if (paymentId && !paymentId.startsWith("hp_")) {
        const pay = await ckoFetch(
          `${host(credentials)}/payments/${paymentId}`,
          token,
        );
        return {
          status: normalize(pay.status),
          gatewayReference: pay.id,
          raw: { hosted: hp, payment: pay },
        };
      }
      return {
        status: normalize(hp.status),
        gatewayReference: hp.id,
        raw: hp,
      };
    }

    const pay = await ckoFetch(
      `${host(credentials)}/payments/${gatewayIntentId}`,
      token,
    );
    return {
      status: normalize(pay.status),
      gatewayReference: pay.id,
      raw: pay,
    };
  },

  async refundPayment(
    gatewayIntentId: string,
    amount: number,
    credentials: GatewayCredentials,
  ): Promise<RefundResult> {
    const token = credentials.CKO_SECRET_KEY;
    if (!token) throw new Error("CKO_SECRET_KEY is not configured");
    const data = await ckoFetch(
      `${host(credentials)}/payments/${gatewayIntentId}/refunds`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ amount: Math.round(amount * 100) }),
      },
    );
    return {
      refundReference: data?.action_id ?? data?.reference ?? "",
      status: "refunded",
      raw: data,
    };
  },

  async handleWebhook(
    req: Request,
    credentials: GatewayCredentials,
  ): Promise<WebhookResult> {
    const raw = await req.text();
    const signature = req.headers.get("cko-signature");
    const secret = credentials.CKO_WEBHOOK_SECRET ?? "";
    const verified = await verifyHmac(raw, signature, secret);
    const payload = raw ? JSON.parse(raw) : {};
    if (!verified) {
      // Surface a recognizable but non-throwing result so the receiver can
      // store it for inspection without acting on it.
      return {
        eventId: payload?.id ?? `cko_unverified_${crypto.randomUUID()}`,
        gatewayIntentId: payload?.data?.id,
        status: "pending",
        raw: { signature_verified: false, payload },
      };
    }
    return {
      eventId: payload.id,
      gatewayIntentId: payload?.data?.id,
      status: eventStatus(payload?.type),
      raw: { signature_verified: true, payload },
    };
  },
};