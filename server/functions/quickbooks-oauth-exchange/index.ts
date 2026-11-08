import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Public endpoint called by the in-app /quickbooks/callback page after Intuit
// redirects back to the product domain. Exchanges the auth code for tokens
// using the integration's stored client credentials, then stores them.
// Body: { code, state, realm_id, redirect_uri }
import { createClient } from "@matbex/client";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const { code, state, realm_id, redirect_uri } = await req.json();
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
      .select("id, client_id, client_secret, provider, settings, organization_id")
      .eq("id", state)
      .maybeSingle();

    if (fetchErr || !integration || integration.provider !== "quickbooks") {
      return new Response(JSON.stringify({ ok: false, error: "integration_not_found" }), {
        status: 404, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!integration.client_id || !integration.client_secret) {
      return new Response(JSON.stringify({ ok: false, error: "missing_credentials" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const basic = btoa(`${integration.client_id}:${integration.client_secret}`);
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri,
      }),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      return new Response(
        JSON.stringify({ ok: false, error: tokenData.error_description ?? tokenData.error ?? "token_exchange_failed" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
    const settings = (integration.settings ?? {}) as Record<string, unknown>;
    const refreshExpiresAt = tokenData.x_refresh_token_expires_in
      ? new Date(Date.now() + Number(tokenData.x_refresh_token_expires_in) * 1000).toISOString()
      : null;

    const { error: updateErr } = await db
      .from("accounting_integrations")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? null,
        token_expires_at: expiresAt,
        organization_id: realm_id ?? integration.organization_id ?? null,
        status: "connected",
        last_error: null,
        settings: { ...settings, refresh_token_expires_at: refreshExpiresAt },
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