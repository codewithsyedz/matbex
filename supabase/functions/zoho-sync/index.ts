// Authenticated edge function. Performs a Zoho Books sync action for the calling owner's tenant.
// Actions: "list_orgs", "set_org", "pull_chart_of_accounts", "push_daily_journal", "test"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function booksApi(region: string): string {
  switch (region) {
    case "eu": return "https://www.zohoapis.eu/books/v3";
    case "in": return "https://www.zohoapis.in/books/v3";
    case "sa": return "https://www.zohoapis.sa/books/v3";
    case "com.au": return "https://www.zohoapis.com.au/books/v3";
    case "jp": return "https://www.zohoapis.jp/books/v3";
    default: return "https://www.zohoapis.com/books/v3";
  }
}
function accountsApi(region: string): string {
  switch (region) {
    case "eu": return "https://accounts.zoho.eu";
    case "in": return "https://accounts.zoho.in";
    case "sa": return "https://accounts.zoho.sa";
    case "com.au": return "https://accounts.zoho.com.au";
    case "jp": return "https://accounts.zoho.jp";
    default: return "https://accounts.zoho.com";
  }
}

async function ensureFreshToken(supabase: any, integration: any) {
  const exp = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
  if (exp - 60_000 > Date.now()) return integration.access_token;
  if (!integration.refresh_token) throw new Error("No refresh_token; please reconnect Zoho");

  const res = await fetch(`${accountsApi(integration.region)}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: integration.refresh_token,
      client_id: integration.client_id,
      client_secret: integration.client_secret,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    await supabase.from("accounting_integrations")
      .update({ status: "expired", last_error: data.error ?? "refresh_failed" })
      .eq("id", integration.id);
    throw new Error(`Token refresh failed: ${data.error ?? "unknown"}`);
  }
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  await supabase.from("accounting_integrations")
    .update({ access_token: data.access_token, token_expires_at: expiresAt, status: "connected" })
    .eq("id", integration.id);
  return data.access_token;
}

async function zohoFetch(integration: any, accessToken: string, path: string, init: RequestInit = {}) {
  const url = `${booksApi(integration.region)}${path}`;
  const headers = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zoho API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabaseUser.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "test";
    const integrationId: string | undefined = body.integration_id;
    if (!integrationId) {
      return new Response(JSON.stringify({ error: "integration_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: integration, error: intErr } = await supabase
      .from("accounting_integrations")
      .select("*").eq("id", integrationId).maybeSingle();
    if (intErr || !integration) {
      return new Response(JSON.stringify({ error: "integration_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is owner of this tenant
    const { data: isOwner } = await supabaseUser.rpc("has_tenant_role", {
      _user_id: user.id, _tenant_id: integration.tenant_id, _role: "owner",
    });
    if (!isOwner) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await ensureFreshToken(supabase, integration);

    const logSync = async (entry: any) => {
      await supabase.from("accounting_sync_log").insert({
        tenant_id: integration.tenant_id,
        integration_id: integration.id,
        provider: integration.provider,
        ...entry,
      });
    };

    if (action === "list_orgs") {
      const data = await zohoFetch(integration, accessToken, "/organizations");
      return new Response(JSON.stringify({ organizations: data.organizations ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (action === "set_org") {
      const orgId = String(body.organization_id ?? "");
      const orgName = String(body.organization_name ?? "");
      if (!orgId) {
        return new Response(JSON.stringify({ error: "organization_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await supabase.from("accounting_integrations")
        .update({ organization_id: orgId, organization_name: orgName })
        .eq("id", integration.id);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (!integration.organization_id) {
      return new Response(JSON.stringify({ error: "no_organization_selected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgQs = `?organization_id=${encodeURIComponent(integration.organization_id)}`;

    if (action === "pull_chart_of_accounts") {
      const data = await zohoFetch(integration, accessToken, `/chartofaccounts${orgQs}`);
      const accounts = data.chartofaccounts ?? [];
      await logSync({
        entity_type: "chart_of_accounts", direction: "pull",
        status: "success", response: { count: accounts.length },
      });
      return new Response(JSON.stringify({ accounts }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (action === "push_daily_journal") {
      // Push a manual journal entry for given date based on sales totals (simple v1).
      const journalDate: string = body.date ?? new Date().toISOString().slice(0, 10);
      const lineItems = body.line_items;
      if (!Array.isArray(lineItems) || lineItems.length < 2) {
        return new Response(JSON.stringify({ error: "line_items[] (>=2) required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const payload = {
        journal_date: journalDate,
        reference_number: `MATBEX-${journalDate}`,
        notes: body.notes ?? `Matbex daily summary ${journalDate}`,
        line_items: lineItems,
      };
      try {
        const data = await zohoFetch(integration, accessToken, `/journals${orgQs}`, {
          method: "POST", body: JSON.stringify(payload),
        });
        await logSync({
          entity_type: "journal", direction: "push", status: "success",
          external_id: String(data?.journal?.journal_id ?? ""), payload, response: data,
        });
        await supabase.from("accounting_integrations")
          .update({ last_sync_at: new Date().toISOString(), last_error: null })
          .eq("id", integration.id);
        return new Response(JSON.stringify({ ok: true, journal: data.journal }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logSync({ entity_type: "journal", direction: "push", status: "error", error_message: msg, payload });
        await supabase.from("accounting_integrations")
          .update({ last_error: msg }).eq("id", integration.id);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (action === "test") {
      const data = await zohoFetch(integration, accessToken, `/organizations`);
      return new Response(JSON.stringify({ ok: true, organizations_count: (data.organizations ?? []).length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("zoho-sync error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});