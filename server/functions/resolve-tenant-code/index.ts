import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
/**
 * Public lookup for the APK device-pairing step.
 *
 * Given a tenant slug ("tenant code") that the restaurant owner shares with
 * the device, return the tenant id + name so the APK can bind itself to that
 * workspace before the cashier/owner signs in.
 *
 * No JWT required - this is the very first call from a fresh device.
 */
serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { code } = await req.json().catch(() => ({ code: "" }));
    const slug = String(code ?? "").trim().toLowerCase();

    if (!slug || slug.length < 2 || slug.length > 64) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid tenant code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin
      .from("tenants")
      .select("id, name, slug, status")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!data) {
      return new Response(
        JSON.stringify({ ok: false, error: "Tenant code not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (data.status === "suspended") {
      return new Response(
        JSON.stringify({ ok: false, error: "This workspace is suspended" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        tenant: { id: data.id, name: data.name, slug: data.slug },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});