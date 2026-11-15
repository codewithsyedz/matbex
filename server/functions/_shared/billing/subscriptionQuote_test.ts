import { test } from "node:test";
import { deepStrictEqual as eq, throws } from "node:assert/strict";
import { quoteAddon, quotePlan, addonRenewalAmount } from "./subscriptionQuote.ts";

const now = new Date("2026-11-15T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 24 * 3600 * 1000);
const starter = { name: "starter", price: 149 };
const pro = { name: "pro", price: 349 };
const enterprise = { name: "enterprise", price: 699 };

test("trial or expired account buys a new period starting now", () => {
  eq(quotePlan({ plan: { name: "trial", price: 0 }, status: "trial", periodEnd: null }, starter, "month", 1, now),
    { mode: "new", months: 1, amount: 149, daysLeft: 0 });
  eq(quotePlan({ plan: starter, status: "active", periodEnd: inDays(-2) }, pro, "year", 2, now),
    { mode: "new", months: 12, amount: 6980, daysLeft: 0 });
});

test("renewing the same plan is the full price per branch", () => {
  eq(quotePlan({ plan: starter, status: "active", periodEnd: inDays(5) }, starter, "month", 3, now),
    { mode: "renew", months: 1, amount: 447, daysLeft: 5 });
});

test("upgrade costs the difference for the days left", () => {
  // (349-149) * 2 branches * 15/30 = 200
  eq(quotePlan({ plan: starter, status: "active", periodEnd: inDays(15) }, pro, "month", 2, now),
    { mode: "upgrade", months: 0, amount: 200, daysLeft: 15 });
});

test("downgrade only in the last 7 days", () => {
  throws(() => quotePlan({ plan: pro, status: "active", periodEnd: inDays(20) }, starter, "month", 1, now), /last 7 days/);
  eq(quotePlan({ plan: pro, status: "active", periodEnd: inDays(6) }, starter, "month", 1, now).mode, "downgrade");
});

test("enterprise only renews for enterprise accounts", () => {
  throws(() => quotePlan({ plan: pro, status: "active", periodEnd: inDays(6) }, enterprise, "month", 1, now), /sales/);
  eq(quotePlan({ plan: enterprise, status: "active", periodEnd: inDays(3) }, enterprise, "month", 1, now).amount, 699);
});

test("unknown plans are refused", () => {
  throws(() => quotePlan({ plan: null, status: "trial", periodEnd: null }, { name: "free", price: 18 }, "month", 1, now), /not available/);
});

test("add-on mid-period costs the days left, at least 1 SAR", () => {
  eq(quoteAddon({ plan: starter, status: "active", periodEnd: inDays(10) }, 15, now), 5);
  eq(quoteAddon({ plan: starter, status: "active", periodEnd: inDays(1) }, 9, now), 1);
  throws(() => quoteAddon({ plan: { name: "trial", price: 0 }, status: "trial", periodEnd: inDays(10) }, 15, now), /Choose a plan/);
  eq(addonRenewalAmount(12, "year"), 120);
});
