// Matbex subscription and add-on payments through Moyasar (server/functions/subscription-pay).
import { db } from "@/integrations/db/client";

export type BillingPeriod = "month" | "year";

export interface PlanQuote {
  mode: "new" | "renew" | "upgrade" | "downgrade";
  months: number;
  days_left: number;
  branches: number;
  plan_amount: number;
  addons: { addon_id: string; name: string; amount: number }[];
  total: number;
  current_period_end: string | null;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.functions.invoke("subscription-pay", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx && typeof ctx.clone === "function" ? await ctx.clone().json().catch(() => null) : null;
    throw new Error(payload?.error || error.message);
  }
  return data as T;
}

export const quotePlan = (planName: string, period: BillingPeriod) =>
  call<PlanQuote>({ action: "quote", plan_name: planName, period });

/** Opens Moyasar's payment page (leaves the app). */
export async function payForPlan(planName: string, period: BillingPeriod) {
  const r = await call<{ pay_url: string }>({ action: "start", kind: "plan", plan_name: planName, period });
  window.location.assign(r.pay_url);
}

export async function payForAddon(addonId: string) {
  const r = await call<{ pay_url: string }>({ action: "start", kind: "addon", addon_id: addonId });
  window.location.assign(r.pay_url);
}

export const subscriptionPaymentStatus = (paymentId: string) =>
  call<{ status: string }>({ action: "status", payment_id: paymentId }).then((r) => r.status);
