// Guest online payment of an online order (server/functions/online-order-pay, public).
import { db } from "@/integrations/db/client";

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.functions.invoke("online-order-pay", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx && typeof ctx.clone === "function" ? await ctx.clone().json().catch(() => null) : null;
    throw new Error(payload?.error || error.message);
  }
  return data as T;
}

/** Whether the restaurant takes online payment (Moyasar enabled for online orders). */
export const onlinePaymentAvailable = (restaurantId: string) =>
  call<{ available: boolean }>({ action: "available", restaurant_id: restaurantId }).then((r) => !!r.available);

/** Opens Moyasar's payment page for the order (or reports it is already paid). */
export async function startOnlinePayment(orderId: string): Promise<"redirected" | "paid"> {
  const r = await call<{ redirect_url?: string; paid?: boolean }>({
    action: "start",
    order_id: orderId,
    return_url: `${window.location.origin}/order/track/${orderId}`,
  });
  if (r.paid) return "paid";
  if (!r.redirect_url) throw new Error("The payment page could not be opened");
  window.location.assign(r.redirect_url);
  return "redirected";
}

/** Asks the server to check the order's payment with Moyasar; returns the order's payment status. */
export const refreshOnlinePayment = (orderId: string) =>
  call<{ payment_status: string }>({ action: "status", order_id: orderId }).then((r) => r.payment_status);
