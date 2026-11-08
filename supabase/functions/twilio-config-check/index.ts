import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { buildCorsHeaders } from "../_shared/cors.ts";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

function maskFrom(from: string): string {
  const digits = from.replace(/^whatsapp:/, "");
  if (digits.length <= 4) return from;
  return `whatsapp:${digits.slice(0, 3)}•••${digits.slice(-3)}`;
}

async function authUser(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

async function isOwner(userId: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);
  const [{ data: tenantRoleRows }, { data: superAdminRow }] = await Promise.all([
    sb
      .from("user_tenant_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "owner")
      .limit(1),
    sb
      .from("superadmin_users")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return (tenantRoleRows?.length ?? 0) > 0 || !!superAdminRow;
}

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await authUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!(await isOwner(user.id))) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action: "status" | "test" = body.action === "test" ? "test" : "status";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    const TWILIO_FROM_RAW = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "";
    const TWILIO_FROM = TWILIO_FROM_RAW || "whatsapp:+14155238886";
    const usingSandbox = !TWILIO_FROM_RAW;

    const envStatus = {
      lovable_api_key_present: !!LOVABLE_API_KEY,
      twilio_connector_present: !!TWILIO_API_KEY,
      whatsapp_from_present: !!TWILIO_FROM_RAW,
      whatsapp_from_masked: maskFrom(TWILIO_FROM),
      using_sandbox_default: usingSandbox,
    };

    if (action === "status") {
      let pingOk = false;
      let pingError: string | undefined;
      let accountSidLast4: string | undefined;
      if (LOVABLE_API_KEY && TWILIO_API_KEY) {
        try {
          const res = await fetch(`${GATEWAY_URL}/Messages.json?PageSize=1`, {
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": TWILIO_API_KEY,
            },
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            pingOk = true;
            const sid: string | undefined = data?.messages?.[0]?.account_sid || data?.account_sid;
            if (sid) accountSidLast4 = sid.slice(-4);
          } else {
            pingError = `Twilio ${res.status}: ${data?.message || JSON.stringify(data).slice(0, 200)}`;
          }
        } catch (e) {
          pingError = e instanceof Error ? e.message : String(e);
        }
      } else {
        pingError = "Twilio connector not configured";
      }

      return new Response(
        JSON.stringify({
          ok: true,
          env: envStatus,
          ping: { ok: pingOk, error: pingError, account_sid_last4: accountSidLast4 },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // action === "test"
    const toRaw: string = String(body.to ?? "").trim();
    if (!/^\+[1-9][0-9]{6,14}$/.test(toRaw)) {
      return new Response(JSON.stringify({ error: "Invalid 'to' (E.164 required, e.g. +9665…)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!LOVABLE_API_KEY || !TWILIO_API_KEY) {
      return new Response(JSON.stringify({ error: "Twilio credentials not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({
      To: `whatsapp:${toRaw}`,
      From: TWILIO_FROM,
      Body: `Matbex test • Twilio connector verified at ${new Date().toISOString()}`,
    });
    const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Twilio ${res.status}: ${data?.message || JSON.stringify(data)}`,
          code: data?.code,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, sid: data.sid, status: data.status, from: TWILIO_FROM }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});