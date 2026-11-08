// Sends a WhatsApp message via Twilio (gateway). Supports freeform and template (ContentSid) modes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { buildCorsHeaders } from "../_shared/cors.ts";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

function toWa(num: string) {
  const n = num.trim();
  return n.startsWith("whatsapp:") ? n : `whatsapp:${n}`;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY is not configured");

    // Auth: require a logged-in user.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: uErr } = await supa.auth.getUser(token);
    if (uErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const to = String(body?.to ?? "").trim();
    const from = String(body?.from ?? "").trim();
    const mode = (body?.mode as string) || (body?.contentSid ? "template" : "freeform");
    const text = (body?.body as string) || "";
    const contentSid = (body?.contentSid as string) || "";
    const contentVariables = body?.contentVariables ?? null;

    if (!to || !from) {
      return new Response(
        JSON.stringify({ error: "Missing 'to' or 'from' (E.164)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const params = new URLSearchParams();
    params.set("To", toWa(to));
    params.set("From", toWa(from));

    if (mode === "template") {
      if (!contentSid) {
        return new Response(
          JSON.stringify({ error: "contentSid required for template mode" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      params.set("ContentSid", contentSid);
      if (contentVariables && typeof contentVariables === "object") {
        params.set("ContentVariables", JSON.stringify(contentVariables));
      }
    } else {
      if (!text) {
        return new Response(
          JSON.stringify({ error: "body (text) required for freeform mode" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      params.set("Body", text);
    }

    const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: "Twilio error", status: res.status, data }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sid: data?.sid,
        status: data?.status,
        to: data?.to,
        from: data?.from,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-whatsapp error", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});