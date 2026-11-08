// Shared helper to load the Matbex *platform* Checkout.com credentials used
// for SaaS billing (plans + addons). Reads from public.platform_settings
// (key = 'checkout_com_platform') first, falls back to env vars so existing
// deployments keep working.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

export interface CkoPlatformCreds {
  environment: "sandbox" | "production";
  secret_key: string;
  public_key: string;
  processing_channel_id: string;
  webhook_secret: string;
}

export function ckoHost(env: "sandbox" | "production"): string {
  return env === "production"
    ? "https://api.checkout.com"
    : "https://api.sandbox.checkout.com";
}

export async function loadCkoPlatformCreds(): Promise<CkoPlatformCreds> {
  const fallback: CkoPlatformCreds = {
    environment:
      (Deno.env.get("CKO_ENVIRONMENT") as "sandbox" | "production") ?? "sandbox",
    secret_key: Deno.env.get("CKO_PLATFORM_SECRET_KEY") ?? "",
    public_key: Deno.env.get("CKO_PLATFORM_PUBLIC_KEY") ?? "",
    processing_channel_id:
      Deno.env.get("CKO_PLATFORM_PROCESSING_CHANNEL_ID") ?? "",
    webhook_secret: Deno.env.get("CKO_PLATFORM_WEBHOOK_SECRET") ?? "",
  };

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const { data } = await admin
      .from("platform_settings")
      .select("value")
      .eq("key", "checkout_com_platform")
      .maybeSingle();
    const v = ((data?.value as any) ?? {}) as Partial<CkoPlatformCreds>;
    return {
      environment: (v.environment ?? fallback.environment) as
        | "sandbox"
        | "production",
      secret_key: v.secret_key || fallback.secret_key,
      public_key: v.public_key || fallback.public_key,
      processing_channel_id:
        v.processing_channel_id || fallback.processing_channel_id,
      webhook_secret: v.webhook_secret || fallback.webhook_secret,
    };
  } catch {
    return fallback;
  }
}