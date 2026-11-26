import { describe, expect, it } from "vitest";
import { computeDeliveryFee, computeRiderCommission } from "../deliveryFee";

// The same cases run against the server's public.compute_delivery_fee (migration
// 20261111123217); keep the two in step so the storefront shows what the order charges.
const TIERS = [
  { min_subtotal: 50, max_subtotal: 100, fee: 5 },
  { min_subtotal: 0, max_subtotal: 50, fee: 10 },
  { min_subtotal: 100, max_subtotal: null, fee: 0 },
];
const CASES: Array<[number, typeof TIERS | null, number, number]> = [
  [30, null, 7, 7], // no tiers: flat fee
  [30, [], 7, 7],
  [0, TIERS, 7, 10],
  [49.99, TIERS, 7, 10],
  [50, TIERS, 7, 5], // lower bound inclusive, upper exclusive
  [99.99, TIERS, 7, 5],
  [100, TIERS, 7, 0],
  [5000, TIERS, 7, 0], // open-ended top tier
  [500, [{ min_subtotal: 0, max_subtotal: 100, fee: 9 }], 7, 9], // above every tier: last tier
  [5, [{ min_subtotal: 20, max_subtotal: 100, fee: 9 }], 7, 9], // below every tier: last tier
];

describe("computeDeliveryFee", () => {
  it.each(CASES)("subtotal %s -> fee", (subtotal, tiers, flat, expected) => {
    expect(computeDeliveryFee(subtotal, tiers, flat)).toBe(expected);
  });
});

describe("computeRiderCommission", () => {
  it("is a percentage of the delivery fee, 0 when either is 0", () => {
    expect(computeRiderCommission(15, 10)).toBe(1.5);
    expect(computeRiderCommission(0, 10)).toBe(0);
    expect(computeRiderCommission(15, 0)).toBe(0);
  });
});
