import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
/**
 * Semrush proxy edge function.
 * Forwards SuperAdmin-initiated calls directly to the Semrush API
 * so secrets stay server-side. Used by /admin/seo dashboard.
 */
import { createClient } from "@matbex/client";

/** Semrush returns semicolon-separated CSV; convert to an array of row objects. */
function csvToJson(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(";");
  return lines.slice(1).map((l) => {
    const cells = l.split(";");
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
  });
}

/** Map the dashboard's logical paths to Semrush endpoints. */
function semrushUrl(path: string, qs: URLSearchParams, key: string): string {
  const [group, type] = path.split("/");
  qs.set("key", key);
  if (group === "user" && type === "limits") return `https://www.semrush.com/users/countapiunits.html?key=${encodeURIComponent(key)}`;
  qs.set("type", type);
  if (group === "backlinks") return `https://api.semrush.com/analytics/v1/?${qs}`;
  return `https://api.semrush.com/?${qs}`;
}

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SEMRUSH_API_KEY = env("SEMRUSH_API_KEY");
    if (!SEMRUSH_API_KEY) throw new Error("SEMRUSH_API_KEY is not configured");

    const API_URL = env("API_URL")!;
    const ANON = env("ANON_KEY")!;

    // SuperAdmin gate
    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(API_URL, ANON, {
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

    const upstream = await fetch(semrushUrl(path, qs, SEMRUSH_API_KEY));
    const raw = await upstream.text();
    let text: string;
    if (!upstream.ok || raw.startsWith("ERROR")) {
      text = JSON.stringify({ error: raw.trim() || upstream.statusText });
    } else if (path === "user/limits") {
      text = JSON.stringify({ api_units: Number(raw.trim()) });
    } else {
      text = JSON.stringify({ data: csvToJson(raw) });
    }
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