import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Public OAuth redirect endpoint. Zoho redirects here with ?code=...&state=<integration_id>&location=<dc>.
// Exchanges the code for tokens using the integration's stored client credentials, then redirects back to the app.
import { createClient } from "@matbex/client";

const APP_URL = env("APP_URL") ?? "https://matbex.com";

function regionToDomain(region: string): string {
  // Zoho accounts domain per data center
  switch (region) {
    case "eu": return "accounts.zoho.eu";
    case "in": return "accounts.zoho.in";
    case "sa": return "accounts.zoho.sa";
    case "com.au": return "accounts.zoho.com.au";
    case "jp": return "accounts.zoho.jp";
    default: return "accounts.zoho.com";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // integration_id
  const error = url.searchParams.get("error");
  const location = url.searchParams.get("location") ?? "";
  const accountsServer = url.searchParams.get("accounts-server") ?? "";

  const redirectBack = (params: Record<string, string>) => {
    const back = new URL(`${APP_URL}/settings`);
    back.searchParams.set("tab", "accounting");
    Object.entries(params).forEach(([k, v]) => back.searchParams.set(k, v));
    return Response.redirect(back.toString(), 302);
  };

  if (error) return redirectBack({ zoho: "error", error });
  if (!code || !state) return redirectBack({ zoho: "error", error: "missing_code_or_state" });

  const db = createClient(
    env("API_URL")!,
    env("SERVICE_ROLE_KEY")!,
  );

  const { data: integration, error: fetchErr } = await db
    .from("accounting_integrations")
    .select("id, client_id, client_secret, region, tenant_id")
    .eq("id", state)
    .maybeSingle();

  if (fetchErr || !integration) return redirectBack({ zoho: "error", error: "integration_not_found" });
  if (!integration.client_id || !integration.client_secret) {
    return redirectBack({ zoho: "error", error: "missing_credentials" });
  }

  // Prefer the accounts-server returned by Zoho; otherwise build from configured region.
  const accountsDomain = accountsServer
    ? new URL(accountsServer).host
    : regionToDomain(location || integration.region);

  const redirectUri = `${env("API_URL")}/functions/v1/zoho-oauth-callback`;

  const tokenRes = await fetch(`https://${accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    return redirectBack({ zoho: "error", error: tokenData.error ?? "token_exchange_failed" });
  }

  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
  const detectedRegion =
    location && ["com","eu","in","sa","com.au","jp"].includes(location)
      ? location
      : integration.region;

  const { error: updateErr } = await db
    .from("accounting_integrations")
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      token_expires_at: expiresAt,
      region: detectedRegion,
      status: "connected",
      last_error: null,
    })
    .eq("id", integration.id);

  if (updateErr) return redirectBack({ zoho: "error", error: "store_token_failed" });

  return redirectBack({ zoho: "connected" });
});