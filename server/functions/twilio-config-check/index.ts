import { twilioConfigured, twilioRequest } from "../_shared/twilio.ts";
import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";

function maskFrom(from: string): string {
  const digits = from.replace(/^whatsapp:/, "");
  if (digits.length <= 4) return from;
  return `whatsapp:${digits.slice(0, 3)}•••${digits.slice(-3)}`;
}

async function authUser(req: Request) {
  const apiUrl = env("API_URL")!;
  const anonKey = env("ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(apiUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

async function isOwner(userId: string): Promise<boolean> {
  const apiUrl = env("API_URL")!;
  const serviceKey = env("SERVICE_ROLE_KEY")!;
  const sb = createClient(apiUrl, serviceKey);
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
    const TWILIO_FROM_RAW = env("TWILIO_WHATSAPP_FROM") ?? "";
    const TWILIO_FROM = TWILIO_FROM_RAW || "whatsapp:+14155238886";
    const usingSandbox = !TWILIO_FROM_RAW;

    const envStatus = {
      twilio_account_sid_present: !!env("TWILIO_ACCOUNT_SID"),
      twilio_auth_present: twilioConfigured(),
      whatsapp_from_present: !!TWILIO_FROM_RAW,
      whatsapp_from_masked: maskFrom(TWILIO_FROM),
      using_sandbox_default: usingSandbox,
    };

    if (action === "status") {
      let pingOk = false;
      let pingError: string | undefined;
      let accountSidLast4: string | undefined;
      if (twilioConfigured()) {
        try {
          const res = await twilioRequest("/Messages.json?PageSize=1", {
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
    if (!twilioConfigured()) {
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
    const res = await twilioRequest("/Messages.json", {
      method: "POST",
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