// Moyasar adapter (https://docs.moyasar.com).
//
// Each restaurant uses its own Moyasar account: the secret key comes from
// payment_gateway_credentials (MOYASAR_SECRET_KEY, sk_test_... or sk_live_...), so money settles
// to that restaurant. A payment is a Moyasar *invoice*: a hosted page that takes mada, Visa /
// Mastercard, Apple Pay and STC Pay. The POS shows its URL as a QR code; online checkout
// redirects to it.
//
// Moyasar POSTs the invoice to callback_url when it is paid. That request is not signed, so it
// is only a hint: payments-webhook looks the invoice up again with the restaurant's key
// (verifyPayment) and trusts only that answer.

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

const BASE = "https://api.moyasar.com/v1";
/** How long a POS QR / payment page stays payable. */
const INVOICE_TTL_MINUTES = 30;

function secretKey(creds: GatewayCredentials): string {
  const key = creds.MOYASAR_SECRET_KEY?.trim();
  if (!key) throw new Error("Moyasar is not set up: add the secret key in Settings → Payment gateways");
  if (!/^sk_(test|live)_/.test(key)) throw new Error("The Moyasar secret key must start with sk_test_ or sk_live_");
  return key;
}

async function call<T>(creds: GatewayCredentials, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${secretKey(creds)}:`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = data?.message || data?.type || `HTTP ${res.status}`;
    const errors = data?.errors ? ` ${JSON.stringify(data.errors)}` : "";
    throw new Error(`Moyasar: ${detail}${errors}`);
  }
  return data as T;
}

interface MoyasarPayment {
  id: string;
  status: string;
  amount: number;
  refunded?: number;
  source?: { type?: string; company?: string; reference_number?: string; authorization_code?: string };
}
interface MoyasarInvoice {
  id: string;
  status: string;
  amount: number;
  currency: string;
  url: string;
  payments?: MoyasarPayment[];
}

const toHalalas = (sar: number) => Math.round(sar * 100);

export function invoiceStatus(status: string): NormalizedStatus {
  switch (status) {
    case "paid": return "captured";
    case "initiated":
    case "on_hold": return "pending";
    case "failed": return "failed";
    case "expired": return "expired";
    case "canceled":
    case "voided": return "canceled";
    case "refunded": return "refunded";
    default: return "pending";
  }
}

const paidPayment = (inv: MoyasarInvoice) =>
  (inv.payments ?? []).find((p) => p.status === "paid" || p.status === "captured");

export const moyasarAdapter: PaymentAdapter = {
  gateway: "moyasar",

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const halalas = toHalalas(input.amount);
    if (halalas < 100) throw new Error("Moyasar's minimum payment is 1.00 SAR");
    const description = String(input.metadata?.description ?? "").slice(0, 200) || `Payment ${input.idempotencyKey.slice(0, 8)}`;
    const inv = await call<MoyasarInvoice>(input.credentials, "POST", "/invoices", {
      amount: halalas,
      currency: "SAR",
      description,
      ...(input.notifyUrl ? { callback_url: input.notifyUrl } : {}),
      ...(input.returnUrl ? { success_url: input.returnUrl, back_url: input.returnUrl } : {}),
      expired_at: new Date(Date.now() + INVOICE_TTL_MINUTES * 60_000).toISOString(),
    });
    if (inv.amount !== halalas || inv.currency !== "SAR") throw new Error("Moyasar returned a different amount or currency");
    return {
      gatewayIntentId: inv.id,
      redirectUrl: inv.url,
      qrPayload: inv.url,
      status: invoiceStatus(inv.status),
      raw: { id: inv.id, status: inv.status, amount: inv.amount, url: inv.url },
    };
  },

  async verifyPayment(gatewayIntentId: string, credentials: GatewayCredentials): Promise<VerifyResult> {
    if (!gatewayIntentId) throw new Error("No Moyasar invoice id");
    const inv = await call<MoyasarInvoice>(credentials, "GET", `/invoices/${encodeURIComponent(gatewayIntentId)}`);
    const p = paidPayment(inv);
    return {
      status: invoiceStatus(inv.status),
      gatewayReference: p?.id,
      raw: {
        invoice_id: inv.id,
        status: inv.status,
        amount_halalas: inv.amount,
        payment: p ? { id: p.id, status: p.status, source: p.source?.type, scheme: p.source?.company, reference_number: p.source?.reference_number, authorization_code: p.source?.authorization_code } : null,
      },
    };
  },

  async refundPayment(gatewayIntentId: string, amount: number, credentials: GatewayCredentials): Promise<RefundResult> {
    const inv = await call<MoyasarInvoice>(credentials, "GET", `/invoices/${encodeURIComponent(gatewayIntentId)}`);
    const p = paidPayment(inv);
    if (!p) throw new Error("This Moyasar invoice has no paid payment to refund");
    const payment = await call<MoyasarPayment>(credentials, "POST", `/payments/${encodeURIComponent(p.id)}/refund`, { amount: toHalalas(amount) });
    const refunded = Number(payment.refunded ?? 0);
    return {
      refundReference: payment.id,
      status: refunded >= payment.amount ? "refunded" : refunded > 0 ? "partial_refunded" : "failed",
      raw: { payment_id: payment.id, status: payment.status, refunded_halalas: refunded, amount_halalas: payment.amount },
    };
  },

  async handleWebhook(req: Request, credentials: GatewayCredentials): Promise<WebhookResult> {
    const body: any = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new Error("Invalid Moyasar notification");
    // Dashboard webhooks carry the shared secret_token; when one is configured, it must match.
    const expected = credentials.MOYASAR_WEBHOOK_SECRET;
    if (expected && body.secret_token !== undefined && body.secret_token !== expected) {
      throw new Error("Moyasar notification secret does not match");
    }
    // Invoice callback: the invoice object. Dashboard webhook: { type, data: payment }.
    const invoiceId: string | undefined =
      typeof body.id === "string" && Array.isArray(body.payments) ? body.id : body.data?.invoice_id ?? undefined;
    if (!invoiceId) throw new Error("Moyasar notification without an invoice id");
    return {
      eventId: `${invoiceId}:${body.type ?? body.status ?? "update"}:${body.updated_at ?? body.data?.updated_at ?? ""}`,
      gatewayIntentId: invoiceId,
      status: "pending",
      verifyWithGateway: true,
      raw: { invoice_id: invoiceId, type: body.type ?? null, status: body.status ?? body.data?.status ?? null },
    };
  },
};
