/** Customer-facing plan names; the database keeps the internal names (pro = Growth). */
const PLAN_LABEL: Record<string, string> = {
  trial: "Trial",
  free: "Free",
  starter: "Starter",
  pro: "Growth",
  enterprise: "Enterprise",
};

export function planLabel(name: string | null | undefined): string {
  if (!name) return "No plan";
  return PLAN_LABEL[name.toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** "SAR 349" — plan prices are per branch per month, excluding VAT. */
export function sarPrice(n: number | string | null | undefined): string {
  return `SAR ${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
