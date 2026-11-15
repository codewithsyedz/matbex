/**
 * What a business pays Matbex through Moyasar (no database access; unit-tested in
 * subscriptionQuote_test.ts). Plans are priced per active branch per month; a year costs
 * 10 months. Each period is paid up front and extends the paid-until date (current_period_end).
 *
 *   no paid period running -> "new": the period starts now
 *   same plan               -> "renew": the period starts where the paid one ends
 *   higher plan             -> "upgrade": the price difference for the days left; same end date
 *   lower plan              -> "downgrade": only in the last 7 days, starts where the paid one ends
 *
 * Add-ons are priced per account per month: bought mid-period they cost the days left to the
 * paid-until date; at renewal they are added for the new period.
 */

export type Period = "month" | "year";
export const SELF_SERVE_PLANS = ["starter", "pro"] as const;
export const DOWNGRADE_WINDOW_DAYS = 7;
const DAY = 24 * 3600 * 1000;

export interface PlanLite { name: string; price: number }
export interface AccountState {
  plan: PlanLite | null;
  status: string;
  periodEnd: Date | null;
}

export interface PlanQuote {
  mode: "new" | "renew" | "upgrade" | "downgrade";
  months: number;
  amount: number;
  daysLeft: number;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const periodMonths = (p: Period) => (p === "year" ? 12 : 1);
export const periodFactor = (p: Period) => (p === "year" ? 10 : 1);

export function daysLeft(account: AccountState, now: Date): number {
  if (!account.periodEnd) return 0;
  return Math.max(0, Math.ceil((account.periodEnd.getTime() - now.getTime()) / DAY));
}

/** A paid period is running: the account is active, on a paid plan, and paid until a future date. */
export function hasPaidPeriod(account: AccountState, now: Date): boolean {
  return !!account.plan && account.plan.price > 0 && account.status !== "trial" && daysLeft(account, now) > 0;
}

export function quotePlan(account: AccountState, target: PlanLite, period: Period, branches: number, now = new Date()): PlanQuote {
  const name = target.name.toLowerCase();
  const current = account.plan?.name.toLowerCase();
  const selfServe = (SELF_SERVE_PLANS as readonly string[]).includes(name);
  if (!selfServe && !(name === "enterprise" && current === "enterprise")) {
    throw new Error(name === "enterprise"
      ? "Enterprise is set up with our team. Contact sales and we will move your account over."
      : "This plan is not available for online payment.");
  }
  if (!(target.price > 0)) throw new Error("This plan has no price");
  const qty = Math.max(1, Math.floor(branches) || 1);
  const full = round2(target.price * qty * periodFactor(period));
  const left = daysLeft(account, now);

  if (!hasPaidPeriod(account, now)) return { mode: "new", months: periodMonths(period), amount: full, daysLeft: 0 };
  if (current === name) return { mode: "renew", months: periodMonths(period), amount: full, daysLeft: left };
  if (target.price > account.plan!.price) {
    const diff = round2((target.price - account.plan!.price) * qty * left / 30);
    return { mode: "upgrade", months: 0, amount: Math.max(1, diff), daysLeft: left };
  }
  if (left > DOWNGRADE_WINDOW_DAYS) {
    throw new Error(`You can move to a smaller plan in the last ${DOWNGRADE_WINDOW_DAYS} days of your paid period (${left} days left).`);
  }
  return { mode: "downgrade", months: periodMonths(period), amount: full, daysLeft: left };
}

/** An add-on bought while a paid period runs: the days left to the paid-until date. */
export function quoteAddon(account: AccountState, monthlyPrice: number, now = new Date()): number {
  if (!hasPaidPeriod(account, now)) throw new Error("Choose a plan first: add-ons run until your plan's paid-until date.");
  return Math.max(1, round2(monthlyPrice * daysLeft(account, now) / 30));
}

/** An add-on renewed together with the plan for a new period. */
export const addonRenewalAmount = (monthlyPrice: number, period: Period) => round2(monthlyPrice * periodFactor(period));
