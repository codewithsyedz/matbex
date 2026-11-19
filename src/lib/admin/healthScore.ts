/**
 * Customer health score (0–100) from the signals admin_tenant_health() returns. Four parts:
 *   usage    30  someone signed in recently
 *   sales    35  sales this week, and how they compare with the 4 weeks before
 *   billing  20  paid up / on trial / past due
 *   setup    15  first-week setup steps done
 * 70+ healthy, 40–69 watch, under 40 at risk. Every point lost comes with a reason.
 * Suspended businesses are reported as "suspended", not scored.
 */
export interface HealthSignals {
  tenant_id: string;
  name: string;
  status: string;
  plan: string | null;
  created_at: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  users: number;
  last_login_at: string | null;
  sales_7d: number;
  sales_prev_28d: number;
  revenue_30d: number;
  last_sale_at: string | null;
  setup_done: number;
  setup_total: number;
}

export type HealthLevel = "healthy" | "watch" | "at_risk" | "suspended";
export interface HealthResult {
  score: number | null;
  level: HealthLevel;
  parts: { usage: number; sales: number; billing: number; setup: number };
  reasons: string[];
}

const DAY = 24 * 3600 * 1000;
const daysSince = (iso: string | null, now: number) => (iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : null);

export function healthScore(s: HealthSignals, now = Date.now()): HealthResult {
  if (s.status === "suspended") {
    return { score: null, level: "suspended", parts: { usage: 0, sales: 0, billing: 0, setup: 0 }, reasons: ["Suspended"] };
  }
  const reasons: string[] = [];
  const age = daysSince(s.created_at, now) ?? 0;

  // Usage: last sign-in by anyone in the business.
  const login = daysSince(s.last_login_at, now);
  let usage = 0;
  if (login == null) reasons.push("Nobody has signed in");
  else if (login <= 3) usage = 30;
  else if (login <= 7) { usage = 20; reasons.push(`Last sign-in ${login} days ago`); }
  else if (login <= 14) { usage = 10; reasons.push(`Last sign-in ${login} days ago`); }
  else reasons.push(`No sign-in for ${login} days`);

  // Sales: activity this week, and the trend against the 4 weeks before (weekly average).
  let sales = 0;
  const weeklyBefore = s.sales_prev_28d / 4;
  const lastSale = daysSince(s.last_sale_at, now);
  if (s.sales_7d > 0) {
    sales = 20;
    if (weeklyBefore === 0 || s.sales_7d >= weeklyBefore * 0.8) sales += 15;
    else if (s.sales_7d >= weeklyBefore * 0.5) { sales += 7; reasons.push(`Sales down ${Math.round((1 - s.sales_7d / weeklyBefore) * 100)}% on the previous 4 weeks`); }
    else reasons.push(`Sales down ${Math.round((1 - s.sales_7d / weeklyBefore) * 100)}% on the previous 4 weeks`);
  } else if (lastSale == null) {
    reasons.push(age <= 7 ? "No sales yet (new business)" : "No sales recorded yet");
    if (age <= 7) sales = 15; // a brand-new business is not at risk for this yet
  } else {
    reasons.push(`No sales for ${lastSale} days`);
  }

  // Billing.
  let billing = 0;
  const paidLeft = s.current_period_end ? Math.ceil((new Date(s.current_period_end).getTime() - now) / DAY) : null;
  const trialLeft = s.trial_ends_at ? Math.ceil((new Date(s.trial_ends_at).getTime() - now) / DAY) : null;
  if (s.status === "past_due") reasons.push("Payment overdue");
  else if (s.status === "expired") reasons.push("Trial ended without a plan");
  else if (s.status === "trial") {
    billing = 12;
    if (trialLeft != null && trialLeft <= 3) reasons.push(trialLeft <= 0 ? "Trial ends today" : `Trial ends in ${trialLeft} days`);
  } else if (s.status === "active") {
    billing = 20;
    if (paidLeft != null && paidLeft >= 0 && paidLeft <= 7) { billing = 15; reasons.push(`Renewal due in ${paidLeft} days`); }
  } else {
    billing = 10;
  }

  // Setup.
  const total = s.setup_total || 6;
  const setup = Math.round((s.setup_done / total) * 15);
  if (s.setup_done < total) reasons.push(`Setup ${s.setup_done} of ${total} steps`);

  const score = usage + sales + billing + setup;
  const level: HealthLevel = score >= 70 ? "healthy" : score >= 40 ? "watch" : "at_risk";
  return { score, level, parts: { usage, sales, billing, setup }, reasons };
}
