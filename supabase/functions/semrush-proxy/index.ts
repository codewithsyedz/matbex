/**
 * Semrush proxy edge function.
 * Forwards SuperAdmin-initiated calls to the Lovable Semrush connector gateway
 * so secrets stay server-side. Used by /admin/seo dashboard.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/semrush";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_PATHS = new Set([
  "domains/domain_ranks",
  "domains/domain_organic",
  "domains/domain_rank_history",
  "backlinks/backlinks_overview",
  "url/url_organic",
  "user/limits",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SEMRUSH_API_KEY = Deno.env.get("SEMRUSH_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!SEMRUSH_API_KEY) throw new Error("SEMRUSH_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    // SuperAdmin gate
    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await supa.auth.getUser();
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isSuper } = await supa.rpc("is_superadmin", {
      _user_id: userRes.user.id,
    });
    const { data: tenantAdminRoles, error: tenantAdminError } = await supa
      .from("user_tenant_roles")
      .select("role")
      .eq("user_id", userRes.user.id)
      .in("role", ["owner", "manager"])
      .limit(1);

    if (tenantAdminError) {
      throw new Error(`Failed to verify tenant admin role: ${tenantAdminError.message}`);
    }

    const isTenantAdmin = (tenantAdminRoles?.length ?? 0) > 0;

    if (!isSuper && !isTenantAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const path: string = body.path ?? "";
    const params: Record<string, string | number> = body.params ?? {};

    if (!ALLOWED_PATHS.has(path)) {
      return new Response(
        JSON.stringify({ error: `Path not allowed: ${path}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.append(k, String(v));

    const upstream = await fetch(`${GATEWAY_URL}/${path}?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": SEMRUSH_API_KEY,
        "Allow-Limit-Offset": "true",
      },
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("semrush-proxy error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});