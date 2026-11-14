import { env } from "../_runtime/env.ts";
// Public webhook that receives Twilio Message Status callbacks (queued,
// sent, delivered, read, failed, undelivered) and writes them to the
// existing notifications audit log so admins can trace each WhatsApp
// summary end-to-end.
//
// Configure the URL in Twilio (or pass it as `StatusCallback` on each
// Message create - which `send-daily-whatsapp-summary` now does):
//   https://<API_DOMAIN>/functions/v1/twilio-status-webhook
//
// Optional: set `TWILIO_AUTH_TOKEN` secret to enable X-Twilio-Signature
// validation. Without it the endpoint still works but logs an unsigned
// warning on each call.
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";
import { createHmac } from "node:crypto";

import { buildCorsHeaders } from "../_shared/cors.ts";
function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  return expected === signature;
}

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Always respond 200 quickly - Twilio retries on non-2xx.
  try {
    const ct = req.headers.get("content-type") ?? "";
    let params: Record<string, string> = {};
    if (ct.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      params = Object.fromEntries(new URLSearchParams(text));
    } else if (ct.includes("application/json")) {
      params = await req.json().catch(() => ({}));
    } else if (req.method === "GET") {
      params = Object.fromEntries(new URL(req.url).searchParams);
    }

    const messageSid = String(params.MessageSid ?? params.SmsSid ?? "").trim();
    const messageStatus = String(params.MessageStatus ?? params.SmsStatus ?? "").trim();
    if (!messageSid || !messageStatus) {
      return new Response(JSON.stringify({ ok: false, error: "Missing MessageSid/MessageStatus" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(
      env("API_URL")!,
      env("SERVICE_ROLE_KEY")!,
    );

    // Optional signature validation
    const authToken = env("TWILIO_AUTH_TOKEN");
    const sig = req.headers.get("x-twilio-signature") ?? "";
    let signatureValid: boolean | null = null;
    if (authToken) {
      // Twilio signs the publicly-reachable URL. Honor x-forwarded-* when
      // the API proxies the request.
      const proto = req.headers.get("x-forwarded-proto") ?? "https";
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
      const url = new URL(req.url);
      const publicUrl = host ? `${proto}://${host}${url.pathname}${url.search}` : req.url;
      signatureValid = !!sig && validateTwilioSignature(authToken, sig, publicUrl, params);
      if (!signatureValid) {
        console.warn("twilio-status-webhook: signature mismatch", { messageSid });
        return new Response(JSON.stringify({ ok: false, error: "Invalid signature" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Locate the original send so we can attach tenant_id/user_id/ymd.
    const { data: originals } = await db
      .from("audit_logs")
      .select("tenant_id, user_id, new_data")
      .eq("entity_type", "whatsapp_summary")
      .in("action", ["whatsapp_summary_sent", "whatsapp_summary_failed"])
      .filter("new_data->>twilio_sid", "eq", messageSid)
      .order("created_at", { ascending: false })
      .limit(1);

    const original = originals?.[0] as
      | { tenant_id: string | null; user_id: string | null; new_data: Record<string, unknown> | null }
      | undefined;
    const originalData = (original?.new_data ?? {}) as Record<string, unknown>;

    const isTerminalFailure = ["failed", "undelivered"].includes(messageStatus.toLowerCase());

    await db.from("audit_logs").insert({
      tenant_id: original?.tenant_id ?? null,
      user_id: original?.user_id ?? null,
      action: isTerminalFailure
        ? "whatsapp_summary_status_failed"
        : "whatsapp_summary_status",
      entity_type: "whatsapp_summary",
      entity_id: messageSid,
      new_data: {
        ok: !isTerminalFailure,
        twilio_sid: messageSid,
        status: messageStatus,
        error_code: params.ErrorCode ?? null,
        error_message: params.ErrorMessage ?? null,
        channel_prefix: params.ChannelPrefix ?? null,
        from: params.From ?? null,
        to_masked: params.To ? String(params.To).replace(/.(?=.{4})/g, "•") : null,
        signature_valid: signatureValid,
        // Mirror metadata from the original send so the audit row is
        // useful even before joining.
        ymd: originalData.ymd ?? null,
        restaurant_id: originalData.restaurant_id ?? null,
        restaurant_name: originalData.restaurant_name ?? null,
        phone_masked: originalData.phone_masked ?? null,
        test: originalData.test ?? null,
      },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("twilio-status-webhook error", msg);
    // Still 200 so Twilio doesn't retry a malformed payload forever.
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});