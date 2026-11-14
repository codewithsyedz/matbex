// Single entry point for POS code to charge an order. Routes through Matbex
// backend - POS clients NEVER talk to a gateway directly.

import { db } from "@/integrations/db/client";

export type PaymentMethod =
  | "mada" | "apple_pay" | "visa" | "mastercard" | "stc_pay" | "cash" | "external_card";

export interface ChargeOrderInput {
  orderId?: string;
  branchId?: string;
  terminalId?: string;
  amount: number;
  method: PaymentMethod;
  channel?: "pos" | "online";
  returnUrl?: string;
  idempotencyKey?: string;
  externalReference?: string; // for bank-terminal recording
}

export interface ChargeOrderResult {
  status: "captured" | "pending" | "failed" | "recorded";
  intentId?: string;
  transactionId?: string;
  redirectUrl?: string;
  qrPayload?: string;
  gateway?: string;
}

/** Cash / external bank terminal - peak-hour safe, no gateway. */
async function recordExternal(input: ChargeOrderInput): Promise<ChargeOrderResult> {
  const kind = input.method === "cash" ? "cash" : "external_card_recorded";
  const { data, error } = await db.functions.invoke("payments-record-external", {
    body: {
      amount: input.amount,
      method: input.method,
      kind,
      branch_id: input.branchId,
      terminal_id: input.terminalId,
      order_id: input.orderId,
      reference: input.externalReference,
    },
  });
  if (error) throw new Error(error.message);
  return { status: "recorded", transactionId: data?.transaction_id };
}

/** Gateway-driven charge (Mada / Apple Pay / STC Pay / cards). */
async function chargeViaGateway(input: ChargeOrderInput): Promise<ChargeOrderResult> {
  const { data, error } = await db.functions.invoke("payments-create-intent", {
    body: {
      amount: input.amount,
      method: input.method,
      branch_id: input.branchId,
      terminal_id: input.terminalId,
      order_id: input.orderId,
      channel: input.channel ?? "pos",
      return_url: input.returnUrl,
      idempotency_key: input.idempotencyKey,
    },
  });
  if (error) throw new Error(error.message);
  return {
    status: data.status === "captured" ? "captured" : "pending",
    intentId: data.intent_id,
    redirectUrl: data.redirect_url,
    qrPayload: data.qr_payload,
    gateway: data.gateway,
  };
}

export async function chargeOrder(input: ChargeOrderInput): Promise<ChargeOrderResult> {
  if (input.method === "cash" || input.method === "external_card") {
    return recordExternal(input);
  }
  return chargeViaGateway(input);
}

/** Poll the orchestrator after redirect/QR return until status is terminal. */
export async function confirmPayment(intentId: string): Promise<"captured" | "failed" | "pending"> {
  const { data, error } = await db.functions.invoke("payments-confirm", {
    body: { intent_id: intentId },
  });
  if (error) throw new Error(error.message);
  if (data.status === "captured") return "captured";
  if (data.status === "failed" || data.status === "expired" || data.status === "canceled") return "failed";
  return "pending";
}