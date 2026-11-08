// Shared payment types for Saudi gateway adapters.

export type PaymentGateway =
  | "hyperpay"
  | "stcpay"
  | "paymob"
  | "moyasar"
  | "amazon_ps"
  | "geidea"
  | "hala"
  | "checkout_com";

export type PaymentMethod =
  | "mada"
  | "apple_pay"
  | "visa"
  | "mastercard"
  | "stc_pay"
  | "cash"
  | "external_card"
  | "tamara"
  | "tabby";

export type NormalizedStatus =
  | "pending"
  | "authorized"
  | "captured"
  | "failed"
  | "expired"
  | "refunded"
  | "partial_refunded"
  | "canceled";

export interface CreateIntentInput {
  tenantId: string;
  branchId?: string | null;
  terminalId?: string | null;
  orderId?: string | null;
  amount: number; // SAR major units
  method: PaymentMethod;
  idempotencyKey: string;
  returnUrl?: string;
  metadata?: Record<string, unknown>;
  credentials: GatewayCredentials;
}

export interface CreateIntentResult {
  gatewayIntentId: string;
  redirectUrl?: string;
  qrPayload?: string;
  clientSecret?: string;
  status: NormalizedStatus;
  raw: unknown;
}

export interface VerifyResult {
  status: NormalizedStatus;
  gatewayReference?: string;
  raw: unknown;
}

export interface RefundResult {
  refundReference: string;
  status: NormalizedStatus;
  raw: unknown;
}

export interface WebhookResult {
  eventId: string;
  gatewayIntentId?: string;
  status: NormalizedStatus;
  raw: unknown;
}

export interface GatewayCredentials {
  // Resolved at the orchestrator layer from env vars / secrets.
  // Free-form to keep adapters flexible per provider.
  [key: string]: string | undefined;
}

export interface PaymentAdapter {
  gateway: PaymentGateway;
  createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  verifyPayment(
    gatewayIntentId: string,
    credentials: GatewayCredentials,
  ): Promise<VerifyResult>;
  refundPayment(
    gatewayIntentId: string,
    amount: number,
    credentials: GatewayCredentials,
  ): Promise<RefundResult>;
  handleWebhook(
    req: Request,
    credentials: GatewayCredentials,
  ): Promise<WebhookResult>;
}

export class NotImplementedError extends Error {
  constructor(gateway: PaymentGateway, method: string) {
    super(`${gateway} adapter does not yet implement ${method}`);
    this.name = "NotImplementedError";
  }
}