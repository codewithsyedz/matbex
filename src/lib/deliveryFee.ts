export interface DeliveryFeeTier {
  min_subtotal: number;
  max_subtotal: number | null; // null = infinity
  fee: number;
}

/**
 * Compute delivery fee from tiered rules.
 * Tier match: min_subtotal <= subtotal < max_subtotal (or no upper bound when null).
 * Falls back to `fallbackFlat` if no tier matches or tiers are empty.
 */
export function computeDeliveryFee(
  subtotal: number,
  tiers: DeliveryFeeTier[] | null | undefined,
  fallbackFlat: number,
): number {
  const list = Array.isArray(tiers) ? tiers : [];
  if (list.length === 0) return Number(fallbackFlat) || 0;
  const sorted = [...list].sort((a, b) => Number(a.min_subtotal) - Number(b.min_subtotal));
  for (const t of sorted) {
    const min = Number(t.min_subtotal) || 0;
    const max = t.max_subtotal === null || t.max_subtotal === undefined ? Infinity : Number(t.max_subtotal);
    if (subtotal >= min && subtotal < max) return Number(t.fee) || 0;
  }
  // If subtotal exceeds the highest tier max, use the last tier's fee
  const last = sorted[sorted.length - 1];
  return Number(last?.fee) || 0;
}

/**
 * Internal rider commission (deducted from delivery fee, does NOT increase customer total).
 * Returns 0 for non-delivery orders.
 */
export function computeRiderCommission(deliveryFee: number, pct: number): number {
  const p = Number(pct) || 0;
  if (p <= 0 || deliveryFee <= 0) return 0;
  return Math.round(deliveryFee * p) / 100;
}