import { describe, it, expect } from "vitest";
import {
  recommendAccount,
  RECOMMENDATION_RULES,
} from "@/lib/coaRecommendation";

/**
 * These tests guarantee that dairy-related categories ALWAYS resolve to
 * 5003 Dairy Cost. The recommendation engine is pure - tenant isolation is
 * enforced downstream by the per-tenant chart_of_accounts row that the
 * codePrefix maps to at write time. Same input → same output, every tenant.
 */
describe("CoA recommendation engine", () => {
  describe("dairy keywords always resolve to 5003", () => {
    const dairyCategories = [
      "Dairy",
      "dairy",
      "DAIRY PRODUCTS",
      "Daily Dairy Order",
      "Milk",
      "Whole Milk",
      "Fresh Milk Supplier",
      "Cheese",
      "Mozzarella Cheese",
      "Cream Cheese",
      "Yogurt",
      "Yoghurt",
      "Greek Yogurt",
      "Cream",
      "Heavy Cream",
      "Whipping Cream",
      "Butter",
      "Salted Butter",
      "Labneh",
      "Ghee",
    ];

    it.each(dairyCategories)("maps %s → 5003 (cogs)", (category) => {
      const rec = recommendAccount(category);
      expect(rec).not.toBeNull();
      expect(rec?.codePrefix).toBe("5003");
      expect(rec?.type).toBe("cogs");
    });

    it("matches dairy keywords inside descriptions even when category is generic", () => {
      const rec = recommendAccount(
        "Kitchen Supply",
        "Weekly milk and butter delivery"
      );
      expect(rec?.codePrefix).toBe("5003");
    });

    it("dairy rule wins over generic food rule (rule ordering)", () => {
      const rec = recommendAccount("Food - Dairy");
      expect(rec?.codePrefix).toBe("5003");
    });

    it("is tenant-agnostic: same input → same recommendation", () => {
      const a = recommendAccount("Dairy");
      const b = recommendAccount("Dairy");
      const c = recommendAccount("Dairy");
      expect(a).toEqual(b);
      expect(b).toEqual(c);
      expect(a?.codePrefix).toBe("5003");
    });
  });

  describe("non-dairy categories do not collide with 5003", () => {
    const nonDairy: Array<[string, string]> = [
      ["Chicken", "5001"],
      ["Vegetables", "5001"],
      ["Beef", "5001"],
      ["Soft Drinks", "5002"],
      ["Coffee Beans", "5002"],
      ["Packaging", "1220"],
      ["Rent - Main Branch", "6100"],
      ["Electricity Bill", "6200"],
      ["Staff Salaries", "6300"],
      ["Facebook Ads", "6400"],
      ["AC Repair", "6500"],
    ];

    it.each(nonDairy)("%s → %s (NOT 5003)", (category, expected) => {
      const rec = recommendAccount(category);
      expect(rec?.codePrefix).toBe(expected);
      expect(rec?.codePrefix).not.toBe("5003");
    });
  });

  describe("edge cases & invariants", () => {
    it("returns null for empty category", () => {
      expect(recommendAccount("")).toBeNull();
    });

    it("returns null for unrecognized category", () => {
      expect(recommendAccount("Mystery Box Subscription")).toBeNull();
    });

    it("dairy rule has codePrefix 5003 and type cogs in the rules table", () => {
      const dairyRule = RECOMMENDATION_RULES.find((r) =>
        r.test.test("dairy")
      );
      expect(dairyRule).toBeDefined();
      expect(dairyRule?.codePrefix).toBe("5003");
      expect(dairyRule?.type).toBe("cogs");
    });

    it("dairy rule appears BEFORE the generic food rule (ordering invariant)", () => {
      const dairyIdx = RECOMMENDATION_RULES.findIndex((r) =>
        r.test.test("dairy")
      );
      const foodIdx = RECOMMENDATION_RULES.findIndex(
        (r) => r.test.test("food") && !r.test.test("dairy")
      );
      expect(dairyIdx).toBeGreaterThan(-1);
      expect(foodIdx).toBeGreaterThan(-1);
      expect(dairyIdx).toBeLessThan(foodIdx);
    });
  });
});