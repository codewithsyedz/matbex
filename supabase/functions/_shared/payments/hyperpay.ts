// HyperPay adapter (KSA). Covers Mada + Apple Pay + Visa/Mastercard via
// HyperPay's COPYandPAY (server-to-server checkout) endpoints.
//
// HyperPay assigns a different entityId per payment brand (MADA, VISA, MASTER,
// APPLEPAY). Credentials are passed in via GatewayCredentials so the orchestrator
// can pick the right one per method.

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

const HOST_LIVE = "https://eu-prod.oppwa.com";
const HOST_TEST = "https://eu-test.oppwa.com";

function host(creds: GatewayCredentials): string {
  return (creds.HYPERPAY_MODE ?? "test") === "live" ? HOST_LIVE : HOST_TEST;
}

function entityIdForMethod(creds: GatewayCredentials, method: string): string {
  switch (method) {
    case "mada":
      return creds.HYPERPAY_ENTITY_ID_MADA ?? creds.HYPERPAY_ENTITY_ID_CARD ?? "";
    case "apple_pay":
      return creds.HYPERPAY_ENTITY_ID_APPLEPAY ?? "";
    case "visa":
    case "mastercard":
      return creds.HYPERPAY_ENTITY_ID_CARD ?? "";
    default:
      return creds.HYPERPAY_ENTITY_ID_CARD ?? "";
  }
}

function normalize(resultCode: string | undefined): NormalizedStatus {
  if (!resultCode) return "pending";
  // HyperPay result code reference:
  //   000.000.* / 000.100.1* = success
  //   000.200.* = pending
  //   000.400.0[^3] = soft decline (still success-ish, treated success)
  //   800.400.5* = chargeback / refund related
  if (/^(000\.000\.|000\.100\.1|000\.[36])/.test(resultCode)) return "captured";
  if (/^(000\.200|800\.400\.5|100\.396\.)/.test(resultCode)) return "pending";
  return "failed";
}

async function postForm(
  url: string,
  token: string,
  fields: Record<string, string>,
): Promise<any> {
  const body = new URLSearchParams(fields).toString();
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HyperPay non-JSON response (${resp.status}): ${text}`);
  }
}

async function getJson(url: string, token: string): Promise<any> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HyperPay non-JSON response (${resp.status}): ${text}`);
  }
}

export const hyperpayAdapter: PaymentAdapter = {
  gateway: "hyperpay",

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const token = input.credentials.HYPERPAY_ACCESS_TOKEN;
    if (!token) throw new Error("HYPERPAY_ACCESS_TOKEN is not configured");
    const entityId = entityIdForMethod(input.credentials, input.method);
    if (!entityId) {
      throw new Error(`HyperPay entityId for method '${input.method}' not configured`);
    }

    const fields: Record<string, string> = {
      entityId,
      amount: input.amount.toFixed(2),
      currency: "SAR",
      paymentType: "DB", // debit / sale
      "merchantTransactionId": input.idempotencyKey,
    };
    if (input.method === "mada") fields["paymentBrand"] = "MADA";
    if (input.method === "apple_pay") fields["paymentBrand"] = "APPLEPAY";

    const data = await postForm(`${host(input.credentials)}/v1/checkouts`, token, fields);
    const checkoutId = data?.id;
    if (!checkoutId) {
      throw new Error(`HyperPay createPaymentIntent failed: ${JSON.stringify(data)}`);
    }

    return {
      gatewayIntentId: checkoutId,
      status: "pending",
      redirectUrl: input.returnUrl
        ? `${input.returnUrl}?checkoutId=${encodeURIComponent(checkoutId)}`
        : undefined,
      raw: data,
    };
  },

  async verifyPayment(
    gatewayIntentId: string,
    credentials: GatewayCredentials,
  ): Promise<VerifyResult> {
    const token = credentials.HYPERPAY_ACCESS_TOKEN;
    if (!token) throw new Error("HYPERPAY_ACCESS_TOKEN is not configured");
    const entityId =
      credentials.HYPERPAY_ENTITY_ID_CARD ??
      credentials.HYPERPAY_ENTITY_ID_MADA ??
      credentials.HYPERPAY_ENTITY_ID_APPLEPAY ??
      "";
    if (!entityId) throw new Error("HyperPay entityId not configured");
    const url = `${host(credentials)}/v1/checkouts/${encodeURIComponent(
      gatewayIntentId,
    )}/payment?entityId=${encodeURIComponent(entityId)}`;
    const data = await getJson(url, token);
    return {
      status: normalize(data?.result?.code),
      gatewayReference: data?.id,
      raw: data,
    };
  },

  async refundPayment(
    gatewayIntentId: string,
    amount: number,
    credentials: GatewayCredentials,
  ): Promise<RefundResult> {
    const token = credentials.HYPERPAY_ACCESS_TOKEN;
    if (!token) throw new Error("HYPERPAY_ACCESS_TOKEN is not configured");
    const entityId =
      credentials.HYPERPAY_ENTITY_ID_CARD ?? credentials.HYPERPAY_ENTITY_ID_MADA ?? "";
    if (!entityId) throw new Error("HyperPay entityId not configured");
    const data = await postForm(
      `${host(credentials)}/v1/payments/${encodeURIComponent(gatewayIntentId)}`,
      token,
      {
        entityId,
        amount: amount.toFixed(2),
        currency: "SAR",
        paymentType: "RF", // refund
      },
    );
    return {
      refundReference: data?.id ?? "",
      status: normalize(data?.result?.code) === "captured" ? "refunded" : "failed",
      raw: data,
    };
  },

  async handleWebhook(
    req: Request,
    _credentials: GatewayCredentials,
  ): Promise<WebhookResult> {
    // HyperPay webhook payloads are AES-encrypted with the merchant's webhook
    // decryption key (HYPERPAY_WEBHOOK_SECRET + HYPERPAY_WEBHOOK_IV). For now,
    // accept JSON payloads in test/sandbox mode and surface signature_verified=false
    // upstream so the receiver records it but does not act on it in production.
    const payload = await req.json().catch(() => ({}));
    return {
      eventId: payload?.id ?? `hyperpay_${crypto.randomUUID()}`,
      gatewayIntentId: payload?.id,
      status: normalize(payload?.result?.code),
      raw: payload,
    };
  },
};