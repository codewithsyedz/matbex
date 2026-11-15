import { test } from "node:test";
import { deepStrictEqual as eq, rejects, ok } from "node:assert/strict";
import { invoiceStatus, moyasarAdapter } from "./moyasar.ts";

const creds = { MOYASAR_SECRET_KEY: "sk_test_abc" };

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return calls;
}

test("invoice statuses map to intent statuses", () => {
  eq(invoiceStatus("paid"), "captured");
  eq(invoiceStatus("initiated"), "pending");
  eq(invoiceStatus("on_hold"), "pending");
  eq(invoiceStatus("expired"), "expired");
  eq(invoiceStatus("voided"), "canceled");
  eq(invoiceStatus("failed"), "failed");
});

test("create invoice sends halalas with basic auth and returns the page as QR", async () => {
  const calls = mockFetch(() => ({ status: 201, body: { id: "inv_1", status: "initiated", amount: 2350, currency: "SAR", url: "https://checkout.moyasar.com/invoices/inv_1" } }));
  const r = await moyasarAdapter.createPaymentIntent({
    tenantId: "t", amount: 23.5, method: "mada", idempotencyKey: "abcdef123456", credentials: creds,
    notifyUrl: "https://api.example/functions/v1/payments-webhook/moyasar",
  });
  eq(calls[0].url, "https://api.moyasar.com/v1/invoices");
  eq((calls[0].init.headers as Record<string, string>).Authorization, `Basic ${btoa("sk_test_abc:")}`);
  const body = JSON.parse(String(calls[0].init.body));
  eq(body.amount, 2350);
  eq(body.currency, "SAR");
  eq(body.callback_url, "https://api.example/functions/v1/payments-webhook/moyasar");
  eq(r.gatewayIntentId, "inv_1");
  eq(r.qrPayload, "https://checkout.moyasar.com/invoices/inv_1");
  eq(r.status, "pending");
});

test("create refuses a publishable key and a missing key", async () => {
  await rejects(moyasarAdapter.createPaymentIntent({ tenantId: "t", amount: 5, method: "mada", idempotencyKey: "k", credentials: { MOYASAR_SECRET_KEY: "pk_test_x" } }), /sk_test_/);
  await rejects(moyasarAdapter.createPaymentIntent({ tenantId: "t", amount: 5, method: "mada", idempotencyKey: "k", credentials: {} }), /not set up/);
});

test("create refuses less than 1 SAR", async () => {
  await rejects(moyasarAdapter.createPaymentIntent({ tenantId: "t", amount: 0.5, method: "mada", idempotencyKey: "k", credentials: creds }), /minimum/);
});

test("Moyasar errors are surfaced", async () => {
  mockFetch(() => ({ status: 401, body: { type: "authentication_error", message: "Invalid authorization credentials" } }));
  await rejects(moyasarAdapter.verifyPayment("inv_1", creds), /Invalid authorization credentials/);
});

test("verify reads the invoice and its paid payment", async () => {
  mockFetch(() => ({ body: { id: "inv_1", status: "paid", amount: 2350, currency: "SAR", url: "u", payments: [
    { id: "pay_failed", status: "failed", amount: 2350 },
    { id: "pay_ok", status: "paid", amount: 2350, source: { type: "creditcard", company: "mada", reference_number: "123" } },
  ] } }));
  const r = await moyasarAdapter.verifyPayment("inv_1", creds);
  eq(r.status, "captured");
  eq(r.gatewayReference, "pay_ok");
});

test("refund refunds the paid payment in halalas", async () => {
  const calls = mockFetch((url) => url.endsWith("/refund")
    ? { body: { id: "pay_ok", status: "refunded", amount: 2350, refunded: 1000 } }
    : { body: { id: "inv_1", status: "paid", amount: 2350, currency: "SAR", url: "u", payments: [{ id: "pay_ok", status: "paid", amount: 2350 }] } });
  const r = await moyasarAdapter.refundPayment("inv_1", 10, creds);
  eq(calls[1].url, "https://api.moyasar.com/v1/payments/pay_ok/refund");
  eq(JSON.parse(String(calls[1].init.body)).amount, 1000);
  eq(r.status, "partial_refunded");
});

test("webhook only names the invoice and asks for verification", async () => {
  const req = new Request("https://x", { method: "POST", body: JSON.stringify({ id: "inv_1", status: "paid", payments: [], updated_at: "t1" }) });
  const r = await moyasarAdapter.handleWebhook(req, {});
  eq(r.gatewayIntentId, "inv_1");
  eq(r.status, "pending");
  ok(r.verifyWithGateway);
});

test("webhook with a wrong secret token is refused", async () => {
  const req = new Request("https://x", { method: "POST", body: JSON.stringify({ type: "payment_paid", secret_token: "nope", data: { invoice_id: "inv_1" } }) });
  await rejects(moyasarAdapter.handleWebhook(req, { MOYASAR_WEBHOOK_SECRET: "right" }), /secret/);
});
