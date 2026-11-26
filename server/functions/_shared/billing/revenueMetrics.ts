// Matbex's own subscription revenue, from what businesses actually paid (subscription_payments)
// and what was refunded (subscription_refunds). All money excludes VAT unless named "cash".
//
// MRR: every paid payment is spread evenly over the period it pays for (a yearly payment counts
// 1/12 per month; an upgrade or a mid-period add-on is spread over the days it covers), net of
// refunds. A refund that ended the period ends that payment's share on the refund date.
// Months are calendar months in Riyadh time (UTC+3, no daylight saving).

const RIYADH_MS = 3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PaymentIn {
  id: string;
  tenant_id: string;
  kind: string;
  mode: string;
  plan: string | null;
  months: number;
  amount: number; // incl. VAT
  subtotal: number | null; // excl. VAT
  refunded_amount: number; // incl. VAT
  period_start: string | null;
  period_end: string | null;
  paid_at: string;
}
export interface RefundIn { payment_id: string; tenant_id: string; amount: number; vat_amount: number; ended_period: boolean; created_at: string }

/** "2026-11" for an instant, in Riyadh time. */
export const monthKey = (d: Date) => new Date(d.getTime() + RIYADH_MS).toISOString().slice(0, 7);
/** The instant a Riyadh month starts. */
export function monthStart(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1) - RIYADH_MS);
}
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

interface Share { tenant_id: string; plan: string; start: number; end: number; monthly: number }

/** Each paid payment's monthly value and the time it covers. */
export function revenueShares(payments: PaymentIn[], refunds: RefundIn[]): Share[] {
  const endedAt = new Map<string, number>();
  for (const r of refunds) {
    if (!r.ended_period) continue;
    const t = new Date(r.created_at).getTime();
    endedAt.set(r.payment_id, Math.min(endedAt.get(r.payment_id) ?? t, t));
  }
  const out: Share[] = [];
  for (const p of payments) {
    const start = new Date(p.period_start ?? p.paid_at).getTime();
    let end = p.period_end ? new Date(p.period_end).getTime() : start + Math.max(p.months, 1) * 30 * DAY_MS;
    if (!(end > start)) continue;
    const amount = Number(p.amount) || 0;
    const subtotal = p.subtotal != null ? Number(p.subtotal) : amount;
    const kept = amount > 0 ? Math.max(0, 1 - Number(p.refunded_amount || 0) / amount) : 0;
    const net = subtotal * kept;
    if (net <= 0) continue;
    const months = p.months > 0 && p.mode !== "upgrade" && p.kind !== "addon" ? p.months : Math.max((end - start) / (30 * DAY_MS), 1 / 30);
    const cut = endedAt.get(p.id);
    if (cut != null && cut < end) end = Math.max(start, cut);
    if (end <= start) continue;
    out.push({ tenant_id: p.tenant_id, plan: p.plan ?? "other", start, end, monthly: net / months });
  }
  return out;
}

/** MRR per business at one instant. */
export function mrrAt(shares: Share[], at: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of shares) if (s.start <= at && at < s.end) m.set(s.tenant_id, (m.get(s.tenant_id) ?? 0) + s.monthly);
  return m;
}

export interface MonthRow {
  month: string;
  mrr: number;
  paying: number;
  new_mrr: number;
  expansion_mrr: number;
  contraction_mrr: number;
  churned_mrr: number;
  new_businesses: number;
  churned_businesses: number;
  cash_collected: number; // incl. VAT
  net_revenue: number; // excl. VAT, after refunds
  refunds: number; // incl. VAT
}

/**
 * Month-by-month figures for the `count` months ending with the month of `now`. A month's MRR and
 * paying businesses are taken at its last instant (for the current month: now).
 */
export function monthlyRevenue(payments: PaymentIn[], refunds: RefundIn[], now: Date, count = 12): MonthRow[] {
  const shares = revenueShares(payments, refunds);
  const current = monthKey(now);
  const months = Array.from({ length: count }, (_, i) => addMonths(current, i - count + 1));
  const at = (key: string) => (key === current ? now.getTime() : monthStart(addMonths(key, 1)).getTime() - 1);
  let prev = mrrAt(shares, monthStart(months[0]).getTime() - 1);
  return months.map((key) => {
    const cur = mrrAt(shares, at(key));
    let newM = 0, exp = 0, con = 0, churn = 0, newB = 0, churnB = 0;
    for (const [t, v] of cur) {
      const before = prev.get(t) ?? 0;
      if (before === 0) { newM += v; newB++; } else if (v > before) exp += v - before; else if (v < before) con += before - v;
    }
    for (const [t, v] of prev) if (!cur.has(t)) { churn += v; churnB++; }
    prev = cur;
    const inMonth = (iso: string) => monthKey(new Date(iso)) === key;
    const paid = payments.filter((p) => inMonth(p.paid_at));
    const refunded = refunds.filter((r) => inMonth(r.created_at));
    const cash = paid.reduce((s, p) => s + Number(p.amount), 0);
    const netSales = paid.reduce((s, p) => s + Number(p.subtotal ?? p.amount), 0)
      - refunded.reduce((s, r) => s + Number(r.amount) - Number(r.vat_amount || 0), 0);
    return {
      month: key,
      mrr: round2([...cur.values()].reduce((s, v) => s + v, 0)),
      paying: cur.size,
      new_mrr: round2(newM),
      expansion_mrr: round2(exp),
      contraction_mrr: round2(con),
      churned_mrr: round2(churn),
      new_businesses: newB,
      churned_businesses: churnB,
      cash_collected: round2(cash),
      net_revenue: round2(netSales),
      refunds: round2(refunded.reduce((s, r) => s + Number(r.amount), 0)),
    };
  });
}

/** MRR now, split by plan and by business. */
export function currentMrr(payments: PaymentIn[], refunds: RefundIn[], now: Date) {
  const shares = revenueShares(payments, refunds);
  const t = now.getTime();
  const byPlan = new Map<string, number>();
  const byTenant = new Map<string, { mrr: number; plans: Set<string> }>();
  for (const s of shares) {
    if (!(s.start <= t && t < s.end)) continue;
    byPlan.set(s.plan, (byPlan.get(s.plan) ?? 0) + s.monthly);
    const e = byTenant.get(s.tenant_id) ?? { mrr: 0, plans: new Set<string>() };
    e.mrr += s.monthly;
    e.plans.add(s.plan);
    byTenant.set(s.tenant_id, e);
  }
  const total = [...byTenant.values()].reduce((s, v) => s + v.mrr, 0);
  return {
    mrr: round2(total),
    by_plan: [...byPlan.entries()].map(([plan, mrr]) => ({ plan, mrr: round2(mrr) })).sort((a, b) => b.mrr - a.mrr),
    by_tenant: [...byTenant.entries()].map(([tenant_id, v]) => ({ tenant_id, mrr: round2(v.mrr) })).sort((a, b) => b.mrr - a.mrr),
  };
}
