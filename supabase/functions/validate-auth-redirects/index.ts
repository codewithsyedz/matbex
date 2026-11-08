import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { buildCorsHeaders } from "../_shared/cors.ts";
// MUST mirror APP_URL in send-daily-whatsapp-summary/index.ts
const WHATSAPP_APP_URL = "https://www.matbex.com";

// Canonical production + preview hosts that magic-links may redirect to.
const EXPECTED_ALLOWLIST = [
  "https://www.matbex.com",
  "https://matbex.com",
  "https://matbex.lovable.app",
  // Lovable preview sandbox (wildcard handled via hostname suffix check below)
  "https://*.lovable.app",
];

function hostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    return EXPECTED_ALLOWLIST.some((allowed) => {
      if (allowed.startsWith("https://*.")) {
        const suffix = allowed.slice("https://*.".length).toLowerCase();
        return host === suffix || host.endsWith(`.${suffix}`);
      }
      try {
        return new URL(allowed).host.toLowerCase() === host;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? null;

    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!token) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve calling user from JWT
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userRes.user) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const next = "/cockpit";
    const desiredRedirect = `${WHATSAPP_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`;

    // Probe GoTrue: if the desired redirect is not in the Supabase allowlist,
    // GoTrue silently rewrites the action_link to SITE_URL - we detect that.
    let actionLink: string | null = null;
    let generateError: string | null = null;
    try {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: userRes.user.email ?? "",
        options: { redirectTo: desiredRedirect },
      });
      if (error) generateError = error.message;
      // @ts-ignore - properties.action_link exists at runtime
      actionLink = data?.properties?.action_link ?? null;
    } catch (e) {
      generateError = e instanceof Error ? e.message : String(e);
    }

    // Extract the redirect_to GoTrue actually accepted
    let effectiveRedirect: string | null = null;
    if (actionLink) {
      try {
        const u = new URL(actionLink);
        effectiveRedirect = u.searchParams.get("redirect_to");
      } catch {
        // ignore
      }
    }

    const desiredAllowed = hostAllowed(desiredRedirect);
    const effectiveAllowed = effectiveRedirect ? hostAllowed(effectiveRedirect) : false;
    const matchesDesired =
      !!effectiveRedirect &&
      new URL(effectiveRedirect).host === new URL(desiredRedirect).host;

    const originAllowed = origin ? hostAllowed(origin) : null;

    return new Response(
      JSON.stringify({
        ok: true,
        whatsapp_app_url: WHATSAPP_APP_URL,
        desired_redirect: desiredRedirect,
        effective_redirect: effectiveRedirect,
        matches_desired: matchesDesired,
        desired_allowed: desiredAllowed,
        effective_allowed: effectiveAllowed,
        origin,
        origin_allowed: originAllowed,
        expected_allowlist: EXPECTED_ALLOWLIST,
        generate_error: generateError,
        supabase_url: SUPABASE_URL,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});