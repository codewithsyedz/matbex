import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";
import { Resend } from "resend";


function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const resend = new Resend(env("RESEND_API_KEY"));

const FROM = "Matbex <noreply@mail.matbex.com>";
const SITE_NAME = "Matbex";
const SITE_URL = "https://www.matbex.com";

function buildHtml(recipient: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#ffffff;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 28px;">
    <h1 style="font-size:24px;font-weight:600;color:#0a0a0a;letter-spacing:-0.02em;margin:0 0 20px;">
      Welcome to ${SITE_NAME}
    </h1>
    <p style="font-size:15px;font-weight:300;color:#4a4a4a;line-height:1.6;margin:0 0 24px;">
      This is a <strong>test confirmation email</strong> from <a href="${SITE_URL}" style="color:#00A859;text-decoration:none;font-weight:500;">${SITE_NAME}</a> - sent to verify branding, sender name, and deliverability.
    </p>
    <p style="font-size:15px;font-weight:300;color:#4a4a4a;line-height:1.6;margin:0 0 24px;">
      Recipient: <a href="mailto:${recipient}" style="color:#00A859;text-decoration:none;">${recipient}</a>
    </p>
    <p style="font-size:15px;font-weight:300;color:#4a4a4a;line-height:1.6;margin:0 0 24px;">
      Sender name shown in your inbox should read <strong>${SITE_NAME}</strong>. If you see anything else, the From configuration needs a redeploy.
    </p>
    <a href="${SITE_URL}" style="background:#00A859;color:#ffffff;font-size:14px;font-weight:500;border-radius:10px;padding:12px 22px;text-decoration:none;display:inline-block;">
      Open ${SITE_NAME}
    </a>
    <p style="font-size:12px;font-weight:300;color:#9a9a9a;line-height:1.5;margin:32px 0 0;">
      Test email triggered from Admin Settings · ${new Date().toUTCString()}
    </p>
  </div>
</body>
</html>`;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(
      env("API_URL") ?? "",
      env("SERVICE_ROLE_KEY") ?? "",
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is SuperAdmin OR has owner/manager role
    const [{ data: superRow }, { data: roles }] = await Promise.all([
      db
        .from("superadmin_users")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle(),
      db
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id),
    ]);

    const isPrivileged =
      !!superRow ||
      (roles ?? []).some((r: { role: string }) =>
        ["owner", "manager"].includes(r.role),
      );
    if (!isPrivileged) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const recipient: string = (body?.recipient || userData.user.email || "").trim();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return new Response(JSON.stringify({ error: "Valid recipient email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const subject = `Test: Confirm your email for ${SITE_NAME}`;
    const response = await resend.emails.send({
      from: FROM,
      to: [recipient],
      subject,
      html: buildHtml(recipient),
    });

    if ((response as any)?.error) {
      console.error("Resend error", response);
      return new Response(
        JSON.stringify({ error: (response as any).error?.message || "Send failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        from: FROM,
        fromName: SITE_NAME,
        recipient,
        subject,
        messageId: (response as any)?.data?.id ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("send-test-confirmation error", e);
    return new Response(JSON.stringify({ error: e?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});