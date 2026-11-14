import { env, envObject } from "../../_runtime/env.ts";
import { PaymentAdapter, PaymentGateway, GatewayCredentials } from "./types.ts";
import { createClient } from "@matbex/client";
import { hyperpayAdapter } from "./hyperpay.ts";
import { halaAdapter } from "./hala.ts";
import { checkoutComAdapter } from "./checkout_com.ts";
import {
  amazonPsAdapter,
  geideaAdapter,
  moyasarAdapter,
  paymobAdapter,
  stcpayAdapter,
} from "./stubs.ts";

const ADAPTERS: Record<PaymentGateway, PaymentAdapter> = {
  hyperpay: hyperpayAdapter,
  stcpay: stcpayAdapter,
  paymob: paymobAdapter,
  moyasar: moyasarAdapter,
  amazon_ps: amazonPsAdapter,
  geidea: geideaAdapter,
  hala: halaAdapter,
  checkout_com: checkoutComAdapter,
};

export function getAdapter(gateway: PaymentGateway): PaymentAdapter {
  const a = ADAPTERS[gateway];
  if (!a) throw new Error(`Unknown payment gateway: ${gateway}`);
  return a;
}

/** Resolve gateway credentials from env (legacy / global fallback). */
export function loadCredentials(gateway: PaymentGateway): GatewayCredentials {
  const env = envObject();
  const prefix = `${gateway.toUpperCase()}_`;
  const out: GatewayCredentials = {};
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith(prefix) || k.startsWith("HYPERPAY_")) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Load credentials for a specific tenant + gateway from
 * `payment_gateway_credentials`. Falls back to env when no row exists.
 * Uses service role so RLS is bypassed safely from server context.
 */
export async function loadTenantCredentials(
  tenantId: string,
  gateway: PaymentGateway,
): Promise<GatewayCredentials> {
  const envCreds = loadCredentials(gateway);
  try {
    const db = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data } = await db
      .from("payment_gateway_credentials")
      .select("credentials")
      .eq("tenant_id", tenantId)
      .eq("gateway", gateway)
      .maybeSingle();
    const dbCreds = (data?.credentials ?? {}) as Record<string, string>;
    return { ...envCreds, ...dbCreds };
  } catch {
    return envCreds;
  }
}