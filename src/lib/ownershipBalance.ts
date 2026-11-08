/**
 * Ownership dilution helpers.
 *
 * When a new partner is given X% of a project, the existing partners are
 * diluted pro-rata so the register always totals exactly 100%. Rounding is
 * done to 2 decimals with the residual pushed onto the largest holder so the
 * sum never drifts (the DB trigger `enforce_project_ownership_total` rejects
 * anything that does not add up).
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface OwnershipHolder {
  id: string;
  name: string;
  pct: number;
}

export interface DilutionResult<T extends OwnershipHolder> {
  /** Existing holders with their new, diluted percentages. */
  holders: Array<T & { newPct: number; delta: number }>;
  /** Percentage granted to the incoming partner. */
  newPartnerPct: number;
  total: number;
}

/**
 * Scales `holders` down (or up) pro-rata so that they occupy `100 - newPartnerPct`.
 * If the current holders sum to 0, the remainder is split equally.
 */
export function diluteForNewPartner<T extends OwnershipHolder>(
  holders: T[],
  newPartnerPct: number,
): DilutionResult<T> {
  const target = round2(Math.max(0, Math.min(100, 100 - newPartnerPct)));
  const current = holders.reduce((s, h) => s + (Number(h.pct) || 0), 0);

  let scaled: Array<T & { newPct: number; delta: number }>;
  if (holders.length === 0) {
    scaled = [];
  } else if (current <= 0) {
    const each = round2(target / holders.length);
    scaled = holders.map((h) => ({ ...h, newPct: each, delta: round2(each - (Number(h.pct) || 0)) }));
  } else {
    const factor = target / current;
    scaled = holders.map((h) => {
      const newPct = round2((Number(h.pct) || 0) * factor);
      return { ...h, newPct, delta: round2(newPct - (Number(h.pct) || 0)) };
    });
  }

  // Push the rounding residual onto the largest holder.
  if (scaled.length) {
    const sum = round2(scaled.reduce((s, h) => s + h.newPct, 0));
    const residual = round2(target - sum);
    if (Math.abs(residual) >= 0.01) {
      let bigIdx = 0;
      scaled.forEach((h, i) => {
        if (h.newPct > scaled[bigIdx].newPct) bigIdx = i;
      });
      const adjusted = round2(scaled[bigIdx].newPct + residual);
      scaled[bigIdx] = {
        ...scaled[bigIdx],
        newPct: adjusted,
        delta: round2(adjusted - (Number(scaled[bigIdx].pct) || 0)),
      };
    }
  }

  return {
    holders: scaled,
    newPartnerPct: round2(Math.max(0, Math.min(100, newPartnerPct))),
    total: round2(scaled.reduce((s, h) => s + h.newPct, 0) + Math.max(0, Math.min(100, newPartnerPct))),
  };
}

/**
 * Rebalances a draft list of partners after `changedIndex` was edited:
 * every other partner is scaled pro-rata into the remaining share.
 */
export function rebalanceDrafts(pcts: number[], changedIndex: number): number[] {
  if (pcts.length <= 1) return pcts.map((_, i) => (i === changedIndex ? 100 : 0));
  const pinned = Math.max(0, Math.min(100, Number(pcts[changedIndex]) || 0));
  const others = pcts
    .map((p, i) => ({ id: String(i), name: String(i), pct: Number(p) || 0 }))
    .filter((_, i) => i !== changedIndex);
  const { holders } = diluteForNewPartner(others, pinned);
  const byIdx = new Map(holders.map((h) => [Number(h.id), h.newPct]));
  return pcts.map((p, i) => (i === changedIndex ? pinned : byIdx.get(i) ?? (Number(p) || 0)));
}
