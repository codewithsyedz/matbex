import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_API_TOKEN_ENV = Deno.env.get("CLOUDFLARE_API_TOKEN");
const CF_ZONE_ID_ENV = Deno.env.get("CLOUDFLARE_ZONE_ID");

async function getCfCreds(supabase: ReturnType<typeof createClient>) {
  try {
    const { data } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "cloudflare")
      .maybeSingle();
    const v = (data?.value ?? {}) as { api_token?: string; zone_id?: string };
    return {
      token: v.api_token || CF_API_TOKEN_ENV || null,
      zoneId: v.zone_id || CF_ZONE_ID_ENV || null,
    };
  } catch {
    return { token: CF_API_TOKEN_ENV ?? null, zoneId: CF_ZONE_ID_ENV ?? null };
  }
}

function mapStatus(s: string | undefined | null): string {
  if (s === "active") return "active";
  if (s === "failed" || s === "deleted" || s === "blocked") return "failed";
  return "provisioning";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const domainId: string | undefined = body?.domain_id;
    if (!domainId) {
      return new Response(JSON.stringify({ error: "domain_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: domain } = await supabase
      .from("tenant_domains")
      .select("id, tenant_id, custom_domain, cf_hostname_id, ssl_status, domain_status")
      .eq("id", domainId)
      .maybeSingle();
    if (!domain) {
      return new Response(JSON.stringify({ error: "Domain not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorize: tenant member OR SuperAdmin
    const { data: membership } = await supabase
      .from("memberships")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("tenant_id", domain.tenant_id)
      .maybeSingle();

    if (!membership) {
      const { data: sa } = await supabase
        .from("superadmin_users")
        .select("id")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (!sa) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Nothing to poll without a Cloudflare hostname.
    if (!domain.cf_hostname_id) {
      return new Response(JSON.stringify({
        ssl_status: domain.ssl_status,
        domain_status: domain.domain_status,
        polled: false,
        message: "Cloudflare hostname not yet provisioned.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { token: cfToken, zoneId } = await getCfCreds(supabase);
    if (!cfToken || !zoneId) {
      return new Response(JSON.stringify({
        ssl_status: domain.ssl_status,
        domain_status: domain.domain_status,
        polled: false,
        message: "Cloudflare not configured.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${domain.cf_hostname_id}`,
      { headers: { "Authorization": `Bearer ${cfToken}` } },
    );
    const json = await res.json();
    const rawSsl = json?.result?.ssl?.status as string | undefined;
    const rawHostname = json?.result?.status as string | undefined;
    const sslStatus = mapStatus(rawSsl);
    const updates: Record<string, unknown> = {
      ssl_status: sslStatus,
      updated_at: new Date().toISOString(),
    };
    // If Cloudflare reports the hostname as active and SSL active, lift domain to active.
    if (sslStatus === "active" && rawHostname === "active" && domain.domain_status !== "active") {
      updates.domain_status = "active";
      updates.dns_verified_at = new Date().toISOString();
    }

    await supabase.from("tenant_domains").update(updates).eq("id", domainId);

    return new Response(JSON.stringify({
      polled: true,
      ssl_status: sslStatus,
      cf_ssl_raw: rawSsl ?? null,
      cf_hostname_raw: rawHostname ?? null,
      domain_status: updates.domain_status ?? domain.domain_status,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("poll-domain-ssl error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});