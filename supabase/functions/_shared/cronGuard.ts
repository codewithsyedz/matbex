import { hasValidCronSecret } from "./cronSecret.ts";
import { requireSuperAdminOrCron } from "./superadmin.ts";
import { requireUser } from "./auth.ts";


/**
 * Guard for internal scheduled-job functions deployed with verify_jwt = false.
 *
 * Accepts either:
 *   - `x-cron-secret` header matching CRON_SECRET (pg_cron / scheduler), or
 *   - a SuperAdmin JWT, or
 *   - (when `allowAnyUser` is true) any authenticated user JWT — used by the
 *     functions that also back an in-app "send now / run now" button.
 *
 * Returns a Response to short-circuit with, or `null` when the caller is allowed.
 */
export async function guardCronCaller(
  req: Request,
  corsHeaders: Record<string, string>,
  opts: { allowAnyUser?: boolean } = {},
): Promise<Response | null> {
  if (await hasValidCronSecret(req)) return null;

  if (opts.allowAnyUser) {
    try {
      await requireUser(req);
      return null;
    } catch (_e) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    await requireSuperAdminOrCron(req);
    return null;
  } catch (resp) {
    if (resp instanceof Response) {
      const body = await resp.text();
      return new Response(body || JSON.stringify({ error: "Unauthorized" }), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}