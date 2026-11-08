/**
 * Helpers to keep a set of split amounts summing exactly to a target total.
 *
 * Used by the project acquisition funding split so the funding lines always
 * add up to the purchase price after any edit.
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Distribute `total` equally across `count` lines, putting the residual on the last line. */
export function distributeEqually(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = round2(total / count);
  const out = Array.from({ length: count }, () => base);
  out[count - 1] = round2(total - base * (count - 1));
  return out;
}

/**
 * Re-balance `amounts` so they sum to `total`.
 * - `lockedIndex` (if provided) keeps its value and the difference is spread over the rest.
 * - Remaining lines are scaled pro-rata by their current value; if they are all zero the
 *   difference is spread equally.
 * - Any rounding residual lands on the last adjustable line.
 */
export function balanceAmounts(amounts: number[], total: number, lockedIndex?: number): number[] {
  const n = amounts.length;
  if (n === 0) return [];

  const idx = amounts.map((_, i) => i).filter((i) => i !== lockedIndex);
  if (idx.length === 0) return [round2(total)];

  const lockedSum = lockedIndex != null ? (amounts[lockedIndex] ?? 0) : 0;
  const remaining = round2(total - lockedSum);
  const currentSum = idx.reduce((s, i) => s + (amounts[i] || 0), 0);

  const next = [...amounts];

  if (currentSum > 0) {
    const ratio = remaining / currentSum;
    idx.forEach((i) => {
      next[i] = round2((amounts[i] || 0) * ratio);
    });
  } else {
    const even = distributeEqually(remaining, idx.length);
    idx.forEach((i, k) => {
      next[i] = even[k];
    });
  }

  // Push any rounding residual onto the last adjustable line.
  const last = idx[idx.length - 1];
  const sumNow = next.reduce((s, v) => s + (v || 0), 0);
  next[last] = round2((next[last] || 0) + (total - sumNow));

  return next;
}

/** True when the amounts already sum to the total within a 1-halala tolerance. */
export function isBalanced(amounts: number[], total: number) {
  return Math.abs(amounts.reduce((s, v) => s + (v || 0), 0) - total) < 0.01;
}

/** Difference between the target total and the sum of the amounts (positive = under-funded). */
export function residual(amounts: number[], total: number) {
  return round2(total - amounts.reduce((s, v) => s + (v || 0), 0));
}

/** Residuals at or below this are treated as rounding noise rather than a real gap. */
export const ROUNDING_TOLERANCE = 1;

export type SplitVariance = "balanced" | "rounding" | "gap";

/** Classify how far a split is from the target total. */
export function classifyVariance(amounts: number[], total: number): SplitVariance {
  const diff = Math.abs(residual(amounts, total));
  if (diff < 0.01) return "balanced";
  return diff <= ROUNDING_TOLERANCE ? "rounding" : "gap";
}

/**
 * One-click correction: push the whole residual onto a single line — by default the
 * largest one, so a rounding difference never distorts the split materially.
 */
export function applyResidualToLargest(amounts: number[], total: number): number[] {
  if (amounts.length === 0) return [];
  const diff = residual(amounts, total);
  if (diff === 0) return amounts;
  let target = 0;
  amounts.forEach((v, i) => {
    if ((v || 0) > (amounts[target] || 0)) target = i;
  });
  const next = [...amounts];
  next[target] = round2((next[target] || 0) + diff);
  return next;
}
