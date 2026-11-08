import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";
import { corsHeaders } from "../_runtime/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const db = createClient(
      env("API_URL")!,
      env("ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await db.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ ok: false, message: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify SuperAdmin via superadmin_users table (service-role bypasses RLS)
    const adminCheck = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
    );
    const { data: saRow } = await adminCheck
      .from("superadmin_users")
      .select("id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!saRow) {
      return new Response(JSON.stringify({ ok: false, message: "SuperAdmin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service-role to read secret platform_settings
    const admin = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
    );
    const { data: row } = await admin
      .from("platform_settings")
      .select("value")
      .eq("key", "cloudflare")
      .maybeSingle();

    const v = (row?.value ?? {}) as { api_token?: string; zone_id?: string };
    if (!v.api_token || !v.zone_id) {
      return new Response(JSON.stringify({ ok: false, message: "Save token and zone ID first." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${v.zone_id}`, {
      headers: { Authorization: `Bearer ${v.api_token}` },
    });
    const json = await res.json();
    if (json.success) {
      return new Response(JSON.stringify({ ok: true, message: `Connected to zone: ${json.result?.name}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      ok: false,
      message: json.errors?.[0]?.message || "Cloudflare rejected the credentials",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, message: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});