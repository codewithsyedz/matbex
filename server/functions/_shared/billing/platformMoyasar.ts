// Matbex's own Moyasar account (subscriptions, add-ons, registrations). Its key lives in
// MATBEX_MOYASAR_SECRET_KEY, deliberately not MOYASAR_*: restaurant payments load MOYASAR_*
// keys per restaurant and must never fall back to Matbex's account.

import { env } from "../../_runtime/env.ts";
import { moyasarAdapter } from "../payments/moyasar.ts";
import { notifyUrl, serviceClient } from "../payments/settle.ts";

export function platformCredentials() {
  const key = env("MATBEX_MOYASAR_SECRET_KEY");
  if (!key) throw new Error("Online payment for Matbex subscriptions is not set up yet. Contact support.");
  return { MOYASAR_SECRET_KEY: key };
}

export interface SubscriptionPaymentRow {
  id: string;
  tenant_id: string | null;
  application_id: string | null;
  kind: "plan" | "addon" | "registration";
  status: string;
  amount: number;
  moyasar_invoice_id: string | null;
  pay_url: string | null;
  created_at: string;
}

/** Opens Moyasar's payment page for a stored subscription payment; returns its URL. */
export async function openPaymentPage(row: SubscriptionPaymentRow, description: string, returnUrl: string): Promise<string> {
  const db = serviceClient();
  const r = await moyasarAdapter.createPaymentIntent({
    tenantId: row.tenant_id ?? "",
    amount: Number(row.amount),
    method: "card",
    idempotencyKey: row.id,
    returnUrl,
    notifyUrl: notifyUrl("moyasar"),
    metadata: { description },
    credentials: platformCredentials(),
  });
  const { error } = await db.from("subscription_payments")
    .update({ moyasar_invoice_id: r.gatewayIntentId, pay_url: r.redirectUrl ?? null, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  return r.redirectUrl!;
}

/**
 * Ask Moyasar (with Matbex's key) about a subscription payment and apply it when paid.
 * Returns the payment's status afterwards. Never trusts anything but Moyasar's answer.
 */
export async function settleSubscriptionPayment(row: SubscriptionPaymentRow): Promise<string> {
  if (row.status === "paid" || !row.moyasar_invoice_id) return row.status;
  const db = serviceClient();
  const v = await moyasarAdapter.verifyPayment(row.moyasar_invoice_id, platformCredentials());
  const raw = v.raw as { amount_halalas?: number };
  if (v.status === "captured") {
    if (raw.amount_halalas !== Math.round(Number(row.amount) * 100)) throw new Error("Moyasar reported a different amount");
    const { error } = await db.rpc("apply_subscription_payment", { p_payment_id: row.id, p_moyasar_payment_id: v.gatewayReference ?? null });
    if (error) throw new Error(error.message);
    return "paid";
  }
  const ended = v.status === "failed" ? "failed" : v.status === "expired" ? "expired" : v.status === "canceled" ? "canceled" : null;
  if (ended) {
    await db.from("subscription_payments").update({ status: ended, updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("status", "pending");
    return ended;
  }
  return "pending";
}
