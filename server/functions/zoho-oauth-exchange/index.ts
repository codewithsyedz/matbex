import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Public endpoint called by the in-app /zoho/callback page after Zoho redirects
// back to the product domain. Exchanges the auth code for tokens using the
// integration's stored client credentials, then stores them.
// Body: { code, state, location?, accounts_server?, redirect_uri }
import { createClient } from "@matbex/client";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function regionToDomain(region: string): string {
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const { code, state, location, accounts_server, redirect_uri } = await req.json();
    if (!code || !state || !redirect_uri) {
      return new Response(JSON.stringify({ ok: false, error: "missing_params" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const db = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
    );

    const { data: integration, error: fetchErr } = await db
      .from("accounting_integrations")
      .select("id, client_id, client_secret, region")
      .eq("id", state)
      .maybeSingle();

    if (fetchErr || !integration) {
      return new Response(JSON.stringify({ ok: false, error: "integration_not_found" }), {
        status: 404, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!integration.client_id || !integration.client_secret) {
      return new Response(JSON.stringify({ ok: false, error: "missing_credentials" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const accountsDomain = accounts_server
      ? new URL(accounts_server).host
      : regionToDomain(location || integration.region);

    const tokenRes = await fetch(`https://${accountsDomain}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: integration.client_id,
        client_secret: integration.client_secret,
        redirect_uri,
        code,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return new Response(JSON.stringify({ ok: false, error: tokenData.error ?? "token_exchange_failed" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
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

    if (updateErr) {
      return new Response(JSON.stringify({ ok: false, error: "store_token_failed" }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});