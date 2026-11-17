// What a business can use, from the same map the app uses (public.tenant_entitlements: plan,
// active add-ons, SuperAdmin overrides, rollout flags). Server functions check features here
// instead of reading plans or flags themselves.

// deno-lint-ignore no-explicit-any
type Db = any;

export interface Entitlements {
  plan: string | null;
  status: string | null;
  features: Record<string, { enabled: boolean; source: string; addons: string[] }>;
  flags: Record<string, { enabled: boolean; source: string }>;
  quotas: Record<string, number>;
}

/** The business's entitlements (service-role client), or null when it does not exist. */
export async function tenantEntitlements(db: Db, tenantId: string): Promise<Entitlements | null> {
  const { data, error } = await db.rpc("tenant_entitlements", { _tenant_id: tenantId });
  if (error) throw new Error(`Could not check the business's plan: ${error.message}`);
  return (data ?? null) as Entitlements | null;
}

/** True when the business can use `key` (a catalogue feature or a rollout flag). */
export async function hasFeature(db: Db, tenantId: string, key: string): Promise<boolean> {
  return (await tenantEntitlements(db, tenantId))?.features?.[key]?.enabled === true;
}
