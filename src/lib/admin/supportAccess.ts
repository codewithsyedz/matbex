import { db } from "@/integrations/db/client";

/** sessionStorage key of the open support-access record, closed when impersonation stops. */
export const SUPPORT_ACCESS_KEY = "supportAccessId";

/** Calls admin-support and returns its JSON, with the function's own error message. */
export async function callAdminSupport<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.functions.invoke("admin-support", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx && typeof ctx.json === "function" ? await ctx.json().then((b: { error?: string }) => b?.error).catch(() => null) : null;
    throw new Error(msg || error.message);
  }
  return data as T;
}

/** Ends the logged support-access session, if one is open (called when impersonation stops). */
export function endSupportAccess() {
  let id: string | null = null;
  try { id = sessionStorage.getItem(SUPPORT_ACCESS_KEY); sessionStorage.removeItem(SUPPORT_ACCESS_KEY); } catch { /* storage blocked */ }
  if (id) void callAdminSupport({ action: "end_access", access_id: id }).catch(() => undefined);
}
