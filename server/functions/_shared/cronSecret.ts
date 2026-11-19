import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";

/**
 * True when the request carries a valid scheduler token.
 * Accepts either the CRON_SECRET env value or the rotating token stored in
 * public.cron_auth_tokens (what pg_cron sends via public.current_cron_token()).
 */
export async function hasValidCronSecret(req: Request): Promise<boolean> {
  const presented = req.headers.get("x-cron-secret");
  if (!presented) return false;

  const cronSecret = env("CRON_SECRET");
  if (cronSecret && presented === cronSecret) return true;

  try {
    const admin = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
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
