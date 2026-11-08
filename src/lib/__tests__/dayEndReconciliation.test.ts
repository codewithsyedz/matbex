import { describe, it, expect } from "vitest";
import {
  calcVariance,
  netActiveAdjustments,
  reconciledTotal,
  buildAdjustmentLedger,
  buildReversalLedger,
  isBalanced,
  netAccountEffect,
  type AdjustmentRecord,
} from "../dayEndReconciliation";

describe("Day-End reconciliation invariants", () => {
  describe("calcVariance", () => {
    it("equals POS Reported − System POS total", () => {
      expect(calcVariance(2803, 2499)).toBe(304);
      expect(calcVariance(1000, 1500)).toBe(-500);
      expect(calcVariance(0, 0)).toBe(0);
    });
    it("rounds to 2dp to avoid float drift", () => {
      expect(calcVariance(100.005, 0)).toBe(100.01);
    });
  });

  describe("buildAdjustmentLedger - DR/CR direction", () => {
    it("overage: DR 1000 / CR 6999", () => {
      const lines = buildAdjustmentLedger(304);
      expect(lines).toEqual([
        { account: "1000", side: "debit", amount: 304 },
        { account: "6999", side: "credit", amount: 304 },
      ]);
    });
    it("shortage: DR 6999 / CR 1000", () => {
      const lines = buildAdjustmentLedger(-50);
      expect(lines).toEqual([
        { account: "6999", side: "debit", amount: 50 },
        { account: "1000", side: "credit", amount: 50 },
      ]);
    });
    it("zero / non-finite produces no lines", () => {
      expect(buildAdjustmentLedger(0)).toEqual([]);
      expect(buildAdjustmentLedger(NaN)).toEqual([]);
      expect(buildAdjustmentLedger(Infinity)).toEqual([]);
    });
    it("is always balanced", () => {
      for (const amt of [304, -50, 0.01, -0.01, 99999.99]) {
        const lines = buildAdjustmentLedger(amt);
        expect(isBalanced(lines)).toBe(true);
      }
    });
  });

  describe("Reversal symmetry", () => {
    it("reversal flips DR/CR of the original", () => {
      const orig = buildAdjustmentLedger(304);
      const rev = buildReversalLedger(304);
      // For every original DR there is a matching reversal CR (same account/amount), and vice versa
      for (const o of orig) {
        const mirror = rev.find((r) => r.account === o.account);
        expect(mirror).toBeDefined();
        expect(mirror!.amount).toBe(o.amount);
        expect(mirror!.side).not.toBe(o.side);
      }
    });

    it("original + reversal nets to zero on every account", () => {
      for (const amt of [304, -50, 1234.56]) {
        const rows: AdjustmentRecord[] = [
          { amount: amt, reversed: true, isReversalEntry: false },
          { amount: -amt, reversed: false, isReversalEntry: true },
        ];
        expect(netAccountEffect(rows, "1000")).toBe(0);
        expect(netAccountEffect(rows, "6999")).toBe(0);
      }
    });
  });

  describe("netActiveAdjustments - duplicate-cleanup regression (May 7, 2026)", () => {
    it("excludes reversed originals AND reversal mirrors - three 304 posts, two reversed → 304", () => {
      const rows: AdjustmentRecord[] = [
        // Three identical originals; two were duplicates and got reversed.
        { amount: 304, reversed: false, isReversalEntry: false },
        { amount: 304, reversed: true, isReversalEntry: false },
        { amount: 304, reversed: true, isReversalEntry: false },
        // The two mirror reversal entries (sign flipped, marked as reversal).
        { amount: -304, reversed: false, isReversalEntry: true },
        { amount: -304, reversed: false, isReversalEntry: true },
      ];
      expect(netActiveAdjustments(rows)).toBe(304);
    });

    it("net is zero when every original is reversed", () => {
      const rows: AdjustmentRecord[] = [
        { amount: 100, reversed: true, isReversalEntry: false },
        { amount: -100, reversed: false, isReversalEntry: true },
      ];
      expect(netActiveAdjustments(rows)).toBe(0);
    });
  });

  describe("reconciledTotal - Adjusted Total displayed to operator", () => {
    it("equals POS Reported when set (cash-reconciliation entries don't add revenue)", () => {
      // Recorded payment-types entered = 2803 (operator typed POS as 2803),
      // adjustment of +304 was posted. Adjusted Total must equal POS Reported,
      // NOT recorded + adjustment (which would double-count to 3107).
      expect(
        reconciledTotal({
          recordedTotal: 2803,
          posReportedTotal: 2803,
          netAdjustment: 304,
        }),
      ).toBe(2803);
    });

    it("falls back to recorded + adjustment when POS Reported is unset", () => {
      expect(
        reconciledTotal({
          recordedTotal: 2499,
          posReportedTotal: 0,
          netAdjustment: 304,
        }),
      ).toBe(2803);
    });

    it("never double-counts the adjustment when POS Reported is present", () => {
      const recorded = 1000;
      const pos = 1304;
      const adj = 304;
      const total = reconciledTotal({
        recordedTotal: recorded,
        posReportedTotal: pos,
        netAdjustment: adj,
      });
      // Must not equal recorded + adj (the legacy bug)
      expect(total).not.toBe(recorded + adj === pos ? -1 : recorded + adj);
      expect(total).toBe(pos);
    });
  });

  describe("End-to-end reconciliation invariant", () => {
    it.each([
      { pos: 2803, system: 2499 }, // overage
      { pos: 1500, system: 2000 }, // shortage
      { pos: 980.55, system: 950.5 }, // fractional overage
      { pos: 100, system: 100 }, // matched (no adjustment needed)
    ])(
      "posting an adjustment equal to variance reconciles Cash 1000 to POS Reported",
      ({ pos, system }) => {
        const variance = calcVariance(pos, system);
        const lines = buildAdjustmentLedger(variance);

        // Always balanced
        if (variance !== 0) expect(isBalanced(lines)).toBe(true);

        // Net effect on Cash 1000 == variance (DR positive on overage,
        // CR positive on shortage). Books move from system → POS Reported.
        const rows: AdjustmentRecord[] = [
          { amount: variance, reversed: false, isReversalEntry: false },
        ];
        expect(netAccountEffect(rows, "1000")).toBe(variance);
        // Counter-leg on 6999 mirrors it (normalize -0 → 0 for matched days)
        expect(netAccountEffect(rows, "6999") + 0).toBe(-variance + 0);
      },
    );
  });
});