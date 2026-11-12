/**
 * Per-branch billing rules, without Stripe or database access (unit-tested in
 * src/lib/__tests__/branchBilling.test.ts). Used by sync-branch-billing and create-checkout.
 *
 * Paid plans are priced per branch per month: a subscription's quantity is the number of
 * active branches, at least 1. Billed automatically: Starter and Growth ('pro'). Enterprise
 * is set up with sales, the legacy 'free' plan keeps its price, trials are not billed.
 */
export const BRANCH_BILLED_PLANS = ["starter", "pro"] as const;

export function isBranchBilledPlan(planName: string | null | undefined): boolean {
  return (BRANCH_BILLED_PLANS as readonly string[]).includes(String(planName ?? "").toLowerCase());
}

/** Quantity to bill: active branches, never below 1 (a paying account with no branch yet). */
export function billedQuantity(activeBranches: number): number {
  return Math.max(1, Math.floor(Number(activeBranches) || 0));
}

export interface SubscriptionItemLite {
  id: string;
  priceId: string;
  quantity: number;
}

/**
 * The change to make on one subscription: the item whose price is one of our plan prices,
 * when its quantity differs from what should be billed. Null when nothing changes or when the
 * subscription has no plan item (never touch items we do not recognise).
 */
export function quantityChange(
  items: SubscriptionItemLite[],
  planPriceIds: string[],
  activeBranches: number,
): { itemId: string; from: number; to: number } | null {
  const planItems = items.filter((i) => planPriceIds.includes(i.priceId));
  if (planItems.length !== 1) return null; // none, or ambiguous: leave it for a person
  const item = planItems[0];
  const to = billedQuantity(activeBranches);
  const from = Number(item.quantity) || 0;
  return from === to ? null : { itemId: item.id, from, to };
}
