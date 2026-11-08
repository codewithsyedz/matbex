// Interface-conformant stubs for the other Saudi gateways. They throw
// NotImplementedError so the orchestrator + ledger + UI all work end-to-end
// today, and lighting up a new gateway is a single-file replacement.

import {
  CreateIntentInput,
  CreateIntentResult,
  GatewayCredentials,
  NotImplementedError,
  PaymentAdapter,
  PaymentGateway,
  RefundResult,
  VerifyResult,
  WebhookResult,
} from "./types.ts";

function makeStub(gateway: PaymentGateway): PaymentAdapter {
  return {
    gateway,
    async createPaymentIntent(_i: CreateIntentInput): Promise<CreateIntentResult> {
      throw new NotImplementedError(gateway, "createPaymentIntent");
    },
    async verifyPayment(_id: string, _c: GatewayCredentials): Promise<VerifyResult> {
      throw new NotImplementedError(gateway, "verifyPayment");
    },
    async refundPayment(
      _id: string,
      _amt: number,
      _c: GatewayCredentials,
    ): Promise<RefundResult> {
      throw new NotImplementedError(gateway, "refundPayment");
    },
    async handleWebhook(_r: Request, _c: GatewayCredentials): Promise<WebhookResult> {
      throw new NotImplementedError(gateway, "handleWebhook");
    },
  };
}

export const stcpayAdapter = makeStub("stcpay");
export const paymobAdapter = makeStub("paymob");
export const moyasarAdapter = makeStub("moyasar");
export const amazonPsAdapter = makeStub("amazon_ps");
export const geideaAdapter = makeStub("geidea");