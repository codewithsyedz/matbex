/**
 * Cost to serve a business (SuperAdmin → Tenant Costs), from admin_tenant_costs() figures and the
 * rates in platform_settings "cost_model". Money in SAR.
 *   infra  monthly estimate (base + storage + email + per user/branch/1k sales), scaled to the period
 *   ai     invoice-scan tokens × the model's USD price per million tokens × SAR/USD
 *   fees   Matbex's own Moyasar payments: percentage of the amount + a fixed fee per payment
 */
export interface CostModel {
  base_infra: number;
  storage_flat: number;
  email_monthly: number;
  per_user: number;
  per_branch: number;
  per_1k_sales: number;
  moyasar_pct: number;
  moyasar_fixed_sar: number;
  usd_to_sar: number;
  /** model id → [input, output] USD per million tokens */
  model_prices: Record<string, [number, number]>;
}

export const DEFAULT_COST_MODEL: CostModel = {
  base_infra: 8,
  storage_flat: 5,
  email_monthly: 2,
  per_user: 1.5,
  per_branch: 3,
  per_1k_sales: 4,
  // Estimates until set to the Moyasar contract (Rates on the page).
  moyasar_pct: 2.75,
  moyasar_fixed_sar: 1,
  usd_to_sar: 3.75,
  model_prices: {
    "claude-opus-5-5": [4, 20],
    "claude-sonnet-5-5": [2, 10],
  },
};

export interface TenantCostRow {
  tenant_id: string;
  name: string;
  status: string;
  plan: string | null;
  plan_price: number;
  users: number;
  branches: number;
  sales: number;
  revenue: number;
  moyasar_amount: number;
  moyasar_payments: number;
  ai_usage: Record<string, { scans: number; input_tokens: number; output_tokens: number }>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function costBreakdown(row: TenantCostRow, m: CostModel, days: number) {
  const months = days / 30;
  const infra = (m.base_infra + m.storage_flat + m.email_monthly + row.users * m.per_user + Math.max(row.branches, 1) * m.per_branch) * months
    + (row.sales / 1000) * m.per_1k_sales;
  let ai = 0;
  let aiScans = 0;
  for (const [model, u] of Object.entries(row.ai_usage ?? {})) {
    // An unknown model is priced like the most expensive one we know (never undercounted).
    const known = m.model_prices[model];
    const [pin, pout] = known ?? Object.values(m.model_prices).reduce((a, b) => (b[0] + b[1] > a[0] + a[1] ? b : a), [0, 0] as [number, number]);
    ai += ((Number(u.input_tokens) * pin + Number(u.output_tokens) * pout) / 1_000_000) * m.usd_to_sar;
    aiScans += Number(u.scans) || 0;
  }
  const fees = (Number(row.moyasar_amount) * m.moyasar_pct) / 100 + Number(row.moyasar_payments) * m.moyasar_fixed_sar;
  const revenue = Number(row.revenue) || 0;
  const total = infra + ai + fees;
  return { revenue: r2(revenue), infra: r2(infra), ai: r2(ai), aiScans, fees: r2(fees), total: r2(total), margin: r2(revenue - total) };
}
