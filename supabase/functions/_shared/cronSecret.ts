import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

/**
 * True when the request carries a valid scheduler token.
 * Accepts either the CRON_SECRET env value or the rotating token stored in
 * public.cron_auth_tokens (what pg_cron sends via public.current_cron_token()).
 */
export async function hasValidCronSecret(req: Request): Promise<boolean> {
  const presented = req.headers.get("x-cron-secret");
  if (!presented) return false;

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && presented === cronSecret) return true;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await admin.rpc("verify_cron_token", { _token: presented });
    if (error) {
      console.error("verify_cron_token failed:", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error("verify_cron_token error", e);
    return false;
  }
}
