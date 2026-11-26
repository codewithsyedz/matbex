import { env } from "../_runtime/env.ts";

/**
 * Plans that can be bought online: plan name -> Stripe price and its amount in halalas (SAR,
 * monthly). The amount must equal plans.price * 100 and the Stripe price itself (checked in
 * create-checkout). Growth (plan 'pro', 349 SAR) is sold online once STRIPE_PRICE_GROWTH holds
 * its Stripe price id; Enterprise is set up with sales.
 */
export const SUBSCRIPTION_PRICES: Record<string, { id: string; amount: number }> = {
  starter: { id: "price_1UZbqQ2MlXQdnUvpbGXV5fsY", amount: 14900 },
  ...(env("STRIPE_PRICE_GROWTH") ? { pro: { id: env("STRIPE_PRICE_GROWTH")!, amount: 34900 } } : {}),
};

export function verifiedPaidPlan(session: {
  status: string | null; payment_status: string; mode: string | null;
  metadata: Record<string, string> | null;
}, tenantId: string, userId: string, priceId: string, subscriptionStatus: string): string {
  if (session.metadata?.tenant_id !== tenantId || session.metadata?.user_id !== userId) {
    throw new Error("This payment belongs to a different account");
  }
  if (session.mode !== "subscription" || session.status !== "complete" || session.payment_status !== "paid" || subscriptionStatus !== "active") {
    throw new Error("Payment has not completed yet");
  }
  const plan = Object.entries(SUBSCRIPTION_PRICES).find(([, price]) => price.id === priceId)?.[0];
  if (!plan || session.metadata?.plan_name !== plan) throw new Error("Payment plan could not be verified");
  return plan;
}

export async function paymentOwner(admin: any, req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Please sign in to manage billing");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user?.email) throw new Error("Please sign in to manage billing");
  const { data: profile, error: profileError } = await admin.from("profiles").select("tenant_id").eq("id", auth.user.id).single();
  if (profileError || !profile?.tenant_id) throw new Error("Account not found");
  const { data: roles, error: roleError } = await admin.from("user_roles").select("role").eq("user_id", auth.user.id);
  if (roleError || !roles?.some((r: { role: string }) => r.role === "owner")) throw new Error("Only account owners can manage billing");
  const { data: tenant, error: tenantError } = await admin.from("tenants").select("id,status,stripe_customer_id").eq("id", profile.tenant_id).single();
  if (tenantError || !tenant) throw new Error("Account not found");
  return { user: auth.user, tenant };
}