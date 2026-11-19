// Card payments taken through a gateway (Moyasar): find the payment of a POS sale or an online
// order, and refund it. Refunds run on the server (payments-refund: owners and managers only,
// capped at what is left of the payment); the browser only reads.
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";

export interface CardPayment {
  intentId: string;
  gateway: string;
  amount: number;
  refunded: number;
  refundable: number;
  status: string;
}

async function load(filter: { saleId?: string; orderId?: string }): Promise<CardPayment | null> {
  let q = db.from("payment_intents").select("id, gateway, amount, status")
    .in("status", ["captured", "partial_refunded", "refunded"]);
  q = filter.saleId ? q.eq("sales_transaction_id", filter.saleId) : q.eq("order_id", filter.orderId!);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  const intent = data?.[0];
  if (!intent) return null;
  const { data: refunds } = await db.from("payment_transactions").select("amount")
    .eq("intent_id", intent.id).eq("kind", "refund").eq("status", "success");
  const refunded = (refunds ?? []).reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
  const amount = Number(intent.amount);
  return {
    intentId: intent.id,
    gateway: String(intent.gateway),
    amount,
    refunded,
    refundable: Math.max(0, Math.round((amount - refunded) * 100) / 100),
    status: String(intent.status),
  };
}

/** The gateway card payment behind a POS sale or an online order, if any. */
export function useCardPayment(filter: { saleId?: string | null; orderId?: string | null }, enabled = true) {
  const key = filter.saleId ? `sale:${filter.saleId}` : `order:${filter.orderId}`;
  return useQuery({
    queryKey: ["card-payment", key],
    enabled: enabled && !!(filter.saleId || filter.orderId),
    queryFn: () => load({ saleId: filter.saleId ?? undefined, orderId: filter.orderId ?? undefined }),
  });
}

/** Refund `amount` SAR of a card payment back to the customer's card. */
export async function refundCardPayment(intentId: string, amount: number): Promise<void> {
  const { data, error } = await db.functions.invoke("payments-refund", { body: { intent_id: intentId, amount } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx && typeof ctx.clone === "function" ? await ctx.clone().json().catch(() => null) : null;
    throw new Error(payload?.error || error.message);
  }
  if (data?.status !== "refunded" && data?.status !== "partial_refunded") {
    throw new Error("The card refund was not confirmed by the payment provider");
  }
}
