import { describe, expect, it } from "vitest";
import { diluteForNewPartner, rebalanceDrafts } from "@/lib/ownershipBalance";

const holders = (...pcts: number[]) =>
  pcts.map((pct, i) => ({ id: `p${i}`, name: `P${i}`, pct }));

describe("diluteForNewPartner", () => {
  it("dilutes 51/49 pro-rata when a 15% partner joins", () => {
    const r = diluteForNewPartner(holders(51, 49), 15);
    expect(r.holders.map((h) => h.newPct)).toEqual([43.35, 41.65]);
    expect(r.total).toBe(100);
  });

  it("keeps the total at exactly 100 with awkward rounding", () => {
    const r = diluteForNewPartner(holders(33.33, 33.33, 33.34), 7);
    expect(r.total).toBe(100);
  });

  it("splits equally when existing holders have no share", () => {
    const r = diluteForNewPartner(holders(0, 0), 40);
    expect(r.holders.map((h) => h.newPct)).toEqual([30, 30]);
  });

  it("clamps a >100% new share", () => {
    const r = diluteForNewPartner(holders(60, 40), 140);
    expect(r.newPartnerPct).toBe(100);
    expect(r.holders.every((h) => h.newPct === 0)).toBe(true);
  });
});

describe("rebalanceDrafts", () => {
  it("scales the other drafts into the remaining share", () => {
    expect(rebalanceDrafts([51, 49, 15], 2)).toEqual([43.35, 41.65, 15]);
  });
  it("gives a lone partner 100%", () => {
    expect(rebalanceDrafts([20], 0)).toEqual([100]);
  });
});
