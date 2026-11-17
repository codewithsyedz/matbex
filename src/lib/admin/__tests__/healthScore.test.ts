import { describe, expect, it } from "vitest";
import { healthScore, type HealthSignals } from "../healthScore";

const NOW = new Date("2026-11-17T12:00:00Z").getTime();
const ago = (days: number) => new Date(NOW - days * 864e5).toISOString();
const ahead = (days: number) => new Date(NOW + days * 864e5).toISOString();
const base = (o: Partial<HealthSignals> = {}): HealthSignals => ({
  tenant_id: "t", name: "Biz", status: "active", plan: "pro", created_at: ago(200), trial_ends_at: null,
  current_period_end: ahead(20), users: 3, last_login_at: ago(1), sales_7d: 300, sales_prev_28d: 1200,
  revenue_30d: 50000, last_sale_at: ago(0), setup_done: 6, setup_total: 6, ...o,
});

describe("customer health score", () => {
  it("a busy, paid-up, fully set-up business is healthy with no reasons", () => {
    const r = healthScore(base(), NOW);
    expect(r.score).toBe(100);
    expect(r.level).toBe("healthy");
    expect(r.reasons).toEqual([]);
  });

  it("falling sales and an absent team lower the score, with reasons", () => {
    const r = healthScore(base({ sales_7d: 100, last_login_at: ago(10) }), NOW);
    expect(r.parts.sales).toBe(20);
    expect(r.parts.usage).toBe(10);
    expect(r.reasons).toContain("Sales down 67% on the previous 4 weeks");
    expect(r.reasons).toContain("Last sign-in 10 days ago");
    expect(r.level).toBe("watch");
  });

  it("no sales for weeks, no sign-ins and payment overdue is at risk", () => {
    const r = healthScore(base({ status: "past_due", sales_7d: 0, sales_prev_28d: 0, last_sale_at: ago(40), last_login_at: ago(30), current_period_end: ago(5) }), NOW);
    expect(r.level).toBe("at_risk");
    expect(r.reasons).toEqual(expect.arrayContaining(["Payment overdue", "No sales for 40 days", "No sign-in for 30 days"]));
  });

  it("a business created this week is not penalised for having no sales yet", () => {
    const r = healthScore(base({ status: "trial", created_at: ago(2), trial_ends_at: ahead(12), current_period_end: null, sales_7d: 0, sales_prev_28d: 0, last_sale_at: null, setup_done: 2 }), NOW);
    expect(r.parts.sales).toBe(15);
    expect(r.reasons).toContain("No sales yet (new business)");
    expect(r.reasons).toContain("Setup 2 of 6 steps");
  });

  it("flags an ending trial and an upcoming renewal", () => {
    expect(healthScore(base({ status: "trial", trial_ends_at: ahead(2), current_period_end: null }), NOW).reasons).toContain("Trial ends in 2 days");
    expect(healthScore(base({ current_period_end: ahead(4) }), NOW).reasons).toContain("Renewal due in 4 days");
  });

  it("suspended businesses are not scored", () => {
    const r = healthScore(base({ status: "suspended" }), NOW);
    expect(r.score).toBeNull();
    expect(r.level).toBe("suspended");
  });
});
