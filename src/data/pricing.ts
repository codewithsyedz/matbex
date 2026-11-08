/**
 * Single source of truth for Matbex plan prices (SAR, per branch, per month, excl. VAT).
 * Annual billing = 2 months free (pay 10 months for 12).
 */
export const SAR_PER_USD = 3.75;

export type PlanKey = "starter" | "growth" | "enterprise";

export const PLAN_PRICES_SAR: Record<PlanKey, { monthly: number; zatca: boolean; nameEn: string; nameAr: string }> = {
  starter: { monthly: 149, zatca: false, nameEn: "Starter Core", nameAr: "الأساسية" },
  growth: { monthly: 349, zatca: true, nameEn: "Growth Bundle", nameAr: "النمو" },
  enterprise: { monthly: 699, zatca: true, nameEn: "Enterprise", nameAr: "المؤسسات" },
};

/** Total charged once per year on annual billing. */
export const annualTotalSar = (k: PlanKey) => PLAN_PRICES_SAR[k].monthly * 10;
/** Effective monthly price on annual billing, rounded to whole riyals. */
export const annualMonthlySar = (k: PlanKey) => Math.round(annualTotalSar(k) / 12);

export function planKeyFromName(name: string): PlanKey | null {
  const n = name.toLowerCase();
  if (n.includes("starter")) return "starter";
  if (n.includes("growth") || n.includes("pro")) return "growth";
  if (n.includes("enterprise")) return "enterprise";
  return null;
}
