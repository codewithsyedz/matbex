/**
 * Pure CoA recommendation rules.
 *
 * These rules map an expense category name (and optional description) to a
 * recommended Chart-of-Accounts code. They are PURE - no React, no Supabase -
 * so the same logic powers the Mapping Audit screen, the CSV import wizard,
 * and the automated test suite.
 *
 * Recommendation contract:
 *   - Returns the FIRST matching rule (rules are evaluated in order).
 *   - Returns null when nothing matches → caller must surface "Unmapped".
 *   - codePrefix is the EXACT 4-digit CoA code the rule recommends. Tenants
 *     that don't yet have that account in their CoA must create it.
 */

export type RecommendedAccountType = "asset" | "cogs" | "expense";

export interface RecommendationRule {
  test: RegExp;
  type: RecommendedAccountType;
  codePrefix: string;
  reason: string;
}

/** Order matters: more specific rules MUST come before broader ones. */
export const RECOMMENDATION_RULES: RecommendationRule[] = [
  {
    test: /\b(dairy|milk|cheese|yog(h)?urt|cream|butter|labneh|ghee)\b/i,
    type: "cogs",
    codePrefix: "5003",
    reason: "Dairy ingredient → COGS 5003 Dairy Cost",
  },
  {
    test: /\b(beverages?|drinks?|sodas?|juices?|waters?|coffee|tea|soft\s*drinks?)\b/i,
    type: "cogs",
    codePrefix: "5002",
    reason: "Beverage ingredient → COGS 5002 Beverage Cost",
  },
  {
    test: /\b(meats?|chickens?|beef|lamb|mutton|fish|seafood|poultry|foods?|ingredients?|produce|vegetables?|veg|fruits?|groceries|grocery|spices?|flour|rice|bread|oils?)\b/i,
    type: "cogs",
    codePrefix: "5001",
    reason: "Food ingredient → COGS 5001 Cost of Food Sold",
  },
  {
    test: /\b(packaging|container|wrap|napkin|disposable|takeaway\s*box|bag)\b/i,
    type: "asset",
    codePrefix: "1220",
    reason: "Stock item → Inventory asset 1220 Packaging",
  },
  {
    test: /\b(rent|lease)\b/i,
    type: "expense",
    codePrefix: "6100",
    reason: "Rent → Operating expense 6100",
  },
  {
    test: /\b(utility|utilities|electric(ity)?|water\s*bill|gas\s*bill|internet|wifi|phone|telecom)\b/i,
    type: "expense",
    codePrefix: "6200",
    reason: "Utilities → Operating expense 6200",
  },
  {
    test: /\b(salary|salaries|payroll|wage|wages|staff\s*meal)\b/i,
    type: "expense",
    codePrefix: "6300",
    reason: "Payroll → Operating expense 6300",
  },
  {
    test: /\b(marketing|advertis|promo|social\s*media|ads?)\b/i,
    type: "expense",
    codePrefix: "6400",
    reason: "Marketing → Operating expense 6400",
  },
  {
    test: /\b(repair|maintenance|cleaning|laundry|pest)\b/i,
    type: "expense",
    codePrefix: "6500",
    reason: "Maintenance → Operating expense 6500",
  },
];

export interface Recommendation {
  type: RecommendedAccountType;
  codePrefix: string;
  reason: string;
}

export function recommendAccount(
  categoryName: string,
  description?: string | null
): Recommendation | null {
  if (!categoryName) return null;
  const haystack = `${categoryName} ${description ?? ""}`;
  for (const rule of RECOMMENDATION_RULES) {
    if (rule.test.test(haystack)) {
      return {
        type: rule.type,
        codePrefix: rule.codePrefix,
        reason: rule.reason,
      };
    }
  }
  return null;
}