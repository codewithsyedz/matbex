import { describe, expect, it } from "vitest";
import { costBreakdown, DEFAULT_COST_MODEL, type TenantCostRow } from "../tenantCosts";

const row = (o: Partial<TenantCostRow> = {}): TenantCostRow => ({
  tenant_id: "t", name: "Biz", status: "active", plan: "pro", plan_price: 349, users: 4, branches: 2, sales: 3000,
  revenue: 349, moyasar_amount: 401.35, moyasar_payments: 1, ai_usage: {}, ...o,
});

describe("tenant cost breakdown", () => {
  it("prices card fees as a percentage plus a fixed fee per payment", () => {
    const c = costBreakdown(row(), DEFAULT_COST_MODEL, 30);
    expect(c.fees).toBe(Math.round((401.35 * 0.0275 + 1) * 100) / 100); // 12.04
  });

  it("prices invoice scans by model tokens in SAR", () => {
    const c = costBreakdown(row({ ai_usage: { "claude-opus-5-5": { scans: 10, input_tokens: 200_000, output_tokens: 50_000 } } }), DEFAULT_COST_MODEL, 30);
    // (0.2M × $4 + 0.05M × $20) × 3.75 = (0.8 + 1.0) × 3.75 = 6.75
    expect(c.ai).toBe(6.75);
    expect(c.aiScans).toBe(10);
  });

  it("prices an unknown model like the most expensive known one", () => {
    const c = costBreakdown(row({ ai_usage: { "some-new-model": { scans: 1, input_tokens: 1_000_000, output_tokens: 0 } } }), DEFAULT_COST_MODEL, 30);
    expect(c.ai).toBe(15); // $4 × 3.75
  });

  it("scales the monthly infrastructure estimate to the period and subtracts everything from what was received", () => {
    const c30 = costBreakdown(row({ moyasar_amount: 0, moyasar_payments: 0 }), DEFAULT_COST_MODEL, 30);
    // 8 + 5 + 2 + 4×1.5 + 2×3 = 27, + 3 × 4 for 3,000 sales = 39
    expect(c30.infra).toBe(39);
    expect(c30.margin).toBe(349 - 39);
    const c90 = costBreakdown(row({ moyasar_amount: 0, moyasar_payments: 0 }), DEFAULT_COST_MODEL, 90);
    expect(c90.infra).toBe(27 * 3 + 12);
  });
});
