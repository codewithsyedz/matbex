import { createClient } from "npm:@supabase/supabase-js@2";
import { getSmsProviderSettings, normalizePhone, sha256Hex } from "../_shared/customerJwt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function genCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, "0");
}

async function sendSmsTwilio(to: string, body: string, from: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY not configured (connect Twilio)");
  const res = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TWILIO_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Twilio error [${res.status}]: ${txt}`);
  }
}

async function sendSmsUnifonic(to: string, body: string, appSid: string, senderId?: string) {
  // Unifonic expects recipient without leading '+'
  const recipient = to.replace(/^\+/, "");
  const params = new URLSearchParams({ AppSid: appSid, Recipient: recipient, Body: body });
  if (senderId) params.set("SenderID", senderId);
  const res = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.success === "false")) {
    throw new Error(`Unifonic error [${res.status}]: ${JSON.stringify(data)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { phone } = await req.json().catch(() => ({}));
    const normalized = normalizePhone(String(phone ?? ""));
    if (!normalized) return json({ error: "Invalid phone. Use E.164 format, e.g. +9665XXXXXXXX." }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate limit: max 3 codes per phone in last 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await admin
      .from("customer_otps")
      .select("id", { count: "exact", head: true })
      .eq("phone", normalized)
      .gte("created_at", tenMinAgo);
    if ((count ?? 0) >= 3) {
      return json({ error: "Too many codes requested. Please wait a few minutes." }, 429);
    }

    const code = genCode();
    const code_hash = await sha256Hex(`${normalized}:${code}`);
    const expires_at = new Date(Date.now() + 5 * 60_000).toISOString();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    const { error: insErr } = await admin
      .from("customer_otps")
      .insert({ phone: normalized, code_hash, expires_at, ip });
    if (insErr) return json({ error: insErr.message }, 500);

    const settings = await getSmsProviderSettings();
    const msg = `Your Matbex verification code is ${code}. Expires in 5 minutes.`;

    const trySend = async (which: "twilio" | "unifonic") => {
      if (which === "unifonic") {
        if (!settings.unifonic?.app_sid) throw new Error("Unifonic AppSid is not configured");
        await sendSmsUnifonic(normalized, msg, settings.unifonic.app_sid, settings.unifonic.sender_id);
      } else {
        if (!settings.twilio?.from) throw new Error("Twilio From number is not configured");
        await sendSmsTwilio(normalized, msg, settings.twilio.from);
      }
    };

    let usedProvider: "twilio" | "unifonic" = settings.primary;
    let fellBack = false;
    try {
      await trySend(settings.primary);
    } catch (primaryErr: any) {
      console.warn(`Primary SMS provider (${settings.primary}) failed:`, primaryErr?.message);
      if (settings.secondary !== "none" && settings.secondary !== settings.primary) {
        try {
          await trySend(settings.secondary);
          usedProvider = settings.secondary;
          fellBack = true;
        } catch (secondaryErr: any) {
          console.error(`Secondary SMS provider (${settings.secondary}) failed:`, secondaryErr?.message);
          throw new Error(
            `Both SMS providers failed. Primary (${settings.primary}): ${primaryErr?.message}. Secondary (${settings.secondary}): ${secondaryErr?.message}`,
          );
        }
      } else {
        throw primaryErr;
      }
    }

    return json({ ok: true, expires_at, provider: usedProvider, fellBack });
  } catch (e: any) {
    console.error("customer-send-otp error", e);
    return json({ error: e?.message ?? "Failed to send code" }, 500);
  }
});