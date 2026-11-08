/**
 * Returns true when a branch (restaurant) should receive automated emails.
 *
 * Skips branches that are:
 *  - archived / non-active (`status != 'active'`)
 *  - suspended (`suspended_at` is set)
 *  - temporarily paused (`paused_until` in the future)
 *
 * Used by every scheduled email worker to honour the "Temporarily off"
 * configuration in Restaurant Locations.
 */
// deno-lint-ignore no-explicit-any
export async function isBranchEmailable(db: any, restaurantId: string): Promise<boolean> {
  if (!restaurantId) return false;
  try {
    const { data, error } = await db
      .from("restaurants")
      .select("status, suspended_at, paused_until")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error || !data) return false;
    if (data.status !== "active") return false;
    if (data.suspended_at) return false;
    if (data.paused_until && new Date(data.paused_until).getTime() > Date.now()) return false;
    return true;
  } catch (_e) {
    return false;
  }
}