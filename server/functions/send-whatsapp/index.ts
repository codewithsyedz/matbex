import { twilioConfigured, twilioRequest } from "../_shared/twilio.ts";
import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Sends a WhatsApp message via Twilio (gateway). Supports freeform and template (ContentSid) modes.
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";

function toWa(num: string) {
  const n = num.trim();
  return n.startsWith("whatsapp:") ? n : `whatsapp:${n}`;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const API_URL = env("API_URL")!;
    const ANON_KEY = env("ANON_KEY")!;

    if (!twilioConfigured()) throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)");

    // Auth: require a logged-in user.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supa = createClient(API_URL, ANON_KEY, {
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

    const res = await twilioRequest("/Messages.json", {
      method: "POST",
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