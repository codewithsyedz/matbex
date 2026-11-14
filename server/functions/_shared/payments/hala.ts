// Hala POS card terminal adapter.
//
// Operating mode (v1 - manual):
//   Hala terminals are standalone bank-supplied devices. The cashier types
//   the amount on the terminal, the customer taps/inserts their card, and
//   the result (approval code / RRN) is read back and recorded in Matbex.
//   In this mode `createPaymentIntent` simply returns a local pending intent;
//   `verifyPayment` is a no-op until the cashier confirms via the POS UI.
//
// Future mode (Hala Cloud API):
//   Once HALA_API_KEY + HALA_MERCHANT_ID + HALA_TERMINAL_ID are provisioned,
//   replace the stubbed sections below with calls to Hala's merchant API to
//   push the amount directly to the terminal and poll for the outcome.

import {
  CreateIntentInput,
  CreateIntentResult,
  GatewayCredentials,
  NotImplementedError,
  PaymentAdapter,
  RefundResult,
  VerifyResult,
  WebhookResult,
} from "./types.ts";

function isLiveMode(creds: GatewayCredentials): boolean {
  return Boolean(creds.HALA_API_KEY && creds.HALA_MERCHANT_ID);
}

export const halaAdapter: PaymentAdapter = {
  gateway: "hala",

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (!isLiveMode(input.credentials)) {
      // Manual mode: just allocate a local reference. The cashier will run
      // the charge on the physical Hala device and confirm via the POS UI,
      // which posts to `payments-record-external` with this reference.
      return {
        gatewayIntentId: `hala_manual_${input.idempotencyKey}`,
        status: "pending",
        raw: { mode: "manual", method: input.method, amount: input.amount },
      };
    }

    // Live mode placeholder - push amount to terminal once Hala API is wired.
    throw new NotImplementedError("hala", "createPaymentIntent (live)");
  },

  async verifyPayment(
    gatewayIntentId: string,
    credentials: GatewayCredentials,
  ): Promise<VerifyResult> {
    if (!isLiveMode(credentials)) {
      // Nothing to verify upstream; the POS UI flips status via record-external.
      return {
        status: "pending",
        gatewayReference: gatewayIntentId,
        raw: { mode: "manual" },
      };
    }
    throw new NotImplementedError("hala", "verifyPayment (live)");
  },

  async refundPayment(
    _gatewayIntentId: string,
    _amount: number,
    credentials: GatewayCredentials,
  ): Promise<RefundResult> {
    if (!isLiveMode(credentials)) {
      // Manual refunds happen on the Hala terminal itself; Matbex only logs
      // a refund ledger row via `payments-refund` with kind="refund".
      throw new Error(
        "Hala refunds in manual mode must be processed on the terminal, then logged via payments-refund.",
      );
    }
    throw new NotImplementedError("hala", "refundPayment (live)");
  },

  async handleWebhook(
    _req: Request,
    _credentials: GatewayCredentials,
  ): Promise<WebhookResult> {
    throw new NotImplementedError("hala", "handleWebhook");
  },
};