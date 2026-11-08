import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_API_TOKEN_ENV = Deno.env.get("CLOUDFLARE_API_TOKEN");
const CF_ZONE_ID_ENV = Deno.env.get("CLOUDFLARE_ZONE_ID");

// What every tenant's custom domain must point its CNAME to.
const CNAME_TARGET = "cname.matbex.com";
// TXT record name prefix for ownership verification.
const TXT_RECORD_NAME = "_matbex-verify";

interface VerifyResult {
  verified: boolean;
  txt_ok: boolean;
  cname_ok: boolean;
  ssl_status: string | null;
  message: string;
}

async function resolveTxt(name: string): Promise<string[]> {
  try {
    const records = await Deno.resolveDns(name, "TXT");
    // TXT records come back as string[][] (chunks per record)
    return records.map((chunks) => chunks.join(""));
  } catch (_e) {
    return [];
  }
}

async function resolveCname(name: string): Promise<string | null> {
  try {
    const records = await Deno.resolveDns(name, "CNAME");
    return records[0]?.toLowerCase().replace(/\.$/, "") ?? null;
  } catch (_e) {
    return null;
  }
}

async function getCloudflareCreds(supabase: ReturnType<typeof createClient>): Promise<{
  token: string | null;
  zoneId: string | null;
}> {
  // Prefer DB-managed (SuperAdmin) settings; fall back to env.
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

async function provisionCloudflareHostname(
  domain: string,
  token: string | null,
  zoneId: string | null,
): Promise<{
  id: string | null;
  ssl_status: string;
  error?: string;
}> {
  if (!token || !zoneId) {
    return { id: null, ssl_status: "pending", error: "Cloudflare not configured" };
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hostname: domain,
          ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
        }),
      },
    );
    const json = await res.json();
    if (!json.success) {
      const msg = json.errors?.[0]?.message ?? "Cloudflare error";
      return { id: null, ssl_status: "failed", error: msg };
    }
    return {
      id: json.result.id,
      ssl_status: json.result.ssl?.status === "active" ? "active" : "provisioning",
    };
  } catch (e) {
    return { id: null, ssl_status: "failed", error: String(e) };
  }
}

async function checkCloudflareSsl(
  hostnameId: string,
  token: string | null,
  zoneId: string | null,
): Promise<string> {
  if (!token || !zoneId) return "pending";
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${hostnameId}`,
      { headers: { "Authorization": `Bearer ${token}` } },
    );
    const json = await res.json();
    const status = json.result?.ssl?.status;
    if (status === "active") return "active";
    if (status === "pending_validation" || status === "pending_issuance" || status === "pending_deployment") return "provisioning";
    if (status === "failed") return "failed";
    return "provisioning";
  } catch {
    return "provisioning";
  }
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

    // Validate caller
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

    // Load domain row
    const { data: domain, error: domErr } = await supabase
      .from("tenant_domains")
      .select("*")
      .eq("id", domainId)
      .maybeSingle();

    if (domErr || !domain) {
      return new Response(JSON.stringify({ error: "Domain not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is a member of the tenant OR a SuperAdmin
    const { data: membership } = await supabase
      .from("memberships")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("tenant_id", domain.tenant_id)
      .maybeSingle();

    let isSuperAdmin = false;
    if (!membership) {
      const { data: saRow } = await supabase
        .from("superadmin_users")
        .select("id")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      isSuperAdmin = !!saRow;
    }

    if (!membership && !isSuperAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!domain.custom_domain || !domain.verification_token) {
      return new Response(JSON.stringify({ error: "Domain not initialized" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customDomain: string = domain.custom_domain;
    const verificationToken: string = domain.verification_token;

    // 1. Verify TXT
    const txtRecords = await resolveTxt(`${TXT_RECORD_NAME}.${customDomain}`);
    const txtOk = txtRecords.some((v) => v.trim() === verificationToken);

    // 2. Verify CNAME
    const cnameValue = await resolveCname(customDomain);
    const cnameOk = cnameValue === CNAME_TARGET;

    const verified = txtOk && cnameOk;
    let sslStatus = domain.ssl_status as string | null;
    let cfHostnameId = domain.cf_hostname_id as string | null;
    let message = "";

    if (verified) {
      const cfCreds = await getCloudflareCreds(supabase);
      // Provision Cloudflare hostname if not yet done
      if (!cfHostnameId) {
        const cf = await provisionCloudflareHostname(customDomain, cfCreds.token, cfCreds.zoneId);
        cfHostnameId = cf.id;
        sslStatus = cf.ssl_status;
        if (cf.error) message = cf.error;
      } else {
        sslStatus = await checkCloudflareSsl(cfHostnameId, cfCreds.token, cfCreds.zoneId);
      }

      await supabase
        .from("tenant_domains")
        .update({
          domain_status: "active",
          ssl_status: sslStatus,
          cf_hostname_id: cfHostnameId,
          dns_verified_at: new Date().toISOString(),
          last_verified_at: new Date().toISOString(),
          verification_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", domainId);

      message = message || "Domain verified successfully.";
    } else {
      const parts: string[] = [];
      if (!txtOk) parts.push(`TXT record ${TXT_RECORD_NAME}.${customDomain} missing or incorrect`);
      if (!cnameOk) parts.push(`CNAME for ${customDomain} should point to ${CNAME_TARGET} (got: ${cnameValue ?? "none"})`);
      message = parts.join("; ");

      await supabase
        .from("tenant_domains")
        .update({
          domain_status: "failed",
          last_verified_at: new Date().toISOString(),
          verification_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", domainId);
    }

    const result: VerifyResult = {
      verified,
      txt_ok: txtOk,
      cname_ok: cnameOk,
      ssl_status: sslStatus,
      message,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("verify-custom-domain error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});