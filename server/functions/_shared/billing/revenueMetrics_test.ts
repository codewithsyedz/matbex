import { test } from "node:test";
import { deepStrictEqual as eq } from "node:assert/strict";
import { currentMrr, monthKey, monthStart, monthlyRevenue, type PaymentIn, type RefundIn } from "./revenueMetrics.ts";

const pay = (o: Partial<PaymentIn>): PaymentIn => ({
  id: crypto.randomUUID(), tenant_id: "a", kind: "plan", mode: "new", plan: "pro", months: 1,
  amount: 401.35, subtotal: 349, refunded_amount: 0, period_start: null, period_end: null, paid_at: "2026-09-01T09:00:00Z", ...o,
});

test("Riyadh months", () => {
  eq(monthKey(new Date("2026-10-31T21:30:00Z")), "2026-11"); // 00:30 on 1 Nov in Riyadh
  eq(monthStart("2026-11").toISOString(), "2026-10-31T21:00:00.000Z");
});

test("a monthly payment counts its full price for its month; a yearly one 1/12 a month", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const p = [
    pay({ tenant_id: "a", period_start: "2026-11-01T00:00:00Z", period_end: "2026-12-01T00:00:00Z", paid_at: "2026-11-01T00:00:00Z" }),
    pay({ tenant_id: "b", months: 12, plan: "starter", amount: 1713.5, subtotal: 1490, period_start: "2026-06-10T00:00:00Z", period_end: "2027-06-10T00:00:00Z", paid_at: "2026-06-10T00:00:00Z" }),
  ];
  const c = currentMrr(p, [], now);
  eq(c.mrr, 349 + 124.17);
  eq(c.by_plan.map((x) => x.plan), ["pro", "starter"]);
});

test("new, churned and refunds by month", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const a1 = pay({ tenant_id: "a", period_start: "2026-09-05T00:00:00Z", period_end: "2026-10-05T00:00:00Z", paid_at: "2026-09-05T00:00:00Z" });
  const a2 = pay({ tenant_id: "a", mode: "renew", period_start: "2026-10-05T00:00:00Z", period_end: "2026-11-05T00:00:00Z", paid_at: "2026-10-04T00:00:00Z" });
  const b1 = pay({ tenant_id: "b", plan: "starter", amount: 171.35, subtotal: 149, period_start: "2026-10-20T00:00:00Z", period_end: "2026-11-20T00:00:00Z", paid_at: "2026-10-20T00:00:00Z" });
  const b2 = pay({ tenant_id: "b", mode: "upgrade", months: 0, amount: 115, subtotal: 100, period_start: "2026-11-05T00:00:00Z", period_end: "2026-11-20T00:00:00Z", paid_at: "2026-11-05T00:00:00Z" });
  const b3 = pay({ tenant_id: "b", mode: "renew", plan: "pro", period_start: "2026-11-20T00:00:00Z", period_end: "2026-12-20T00:00:00Z", paid_at: "2026-11-19T00:00:00Z", refunded_amount: 100 });
  const refunds: RefundIn[] = [{ payment_id: b3.id, tenant_id: "b", amount: 100, vat_amount: 13.04, ended_period: false, created_at: "2026-11-19T10:00:00Z" }];
  const rows = monthlyRevenue([a1, a2, b1, b2, b3], refunds, now, 3);
  eq(rows.map((r) => r.month), ["2026-09", "2026-10", "2026-11"]);
  eq(rows[0].mrr, 349); eq(rows[0].new_businesses, 1);
  eq(rows[1].mrr, 349 + 149); eq(rows[1].new_businesses, 1);
  // November: a lapsed on 5 Nov (churn 349); b now on Growth, 349 less the refunded share.
  eq(rows[2].churned_businesses, 1); eq(rows[2].churned_mrr, 349);
  eq(rows[2].paying, 1);
  eq(rows[2].mrr, Math.round(349 * (1 - 100 / 401.35) * 100) / 100);
  eq(rows[2].refunds, 100);
  eq(rows[2].cash_collected, 115 + 401.35);
});

test("a refund that ended the period stops its MRR on the refund date", () => {
  const p = pay({ tenant_id: "a", months: 12, amount: 4013.5, subtotal: 3490, period_start: "2026-01-01T00:00:00Z", period_end: "2027-01-01T00:00:00Z", paid_at: "2026-01-01T00:00:00Z", refunded_amount: 2000 });
  const r: RefundIn[] = [{ payment_id: p.id, tenant_id: "a", amount: 2000, vat_amount: 260.87, ended_period: true, created_at: "2026-06-15T00:00:00Z" }];
  eq(currentMrr([p], r, new Date("2026-05-01T00:00:00Z")).mrr > 0, true);
  eq(currentMrr([p], r, new Date("2026-07-01T00:00:00Z")).mrr, 0);
});
