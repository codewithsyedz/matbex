import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface EmailReportRequest {
  /** Base64-encoded PDF (no data-uri prefix). */
  pdf_base64: string;
  file_name: string;
  report_title: string;
  subtitle?: string;
  /** Optional override; defaults to the signed-in caller's own email. */
  to?: string;
}

const esc = (v: string) =>
  String(v ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    let auth;
    try {
      auth = await requireUser(req);
    } catch (resp) {
      if (resp instanceof Response) {
        return json({ error: "Unauthorized" }, resp.status);
      }
      throw resp;
    }

    const body: EmailReportRequest = await req.json();
    const recipient = (body.to || auth.email || "").trim();
    if (!recipient) {
      return json({ error: "No recipient email available for your account" }, 400);
    }
    if (!body.pdf_base64) {
      return json({ error: "Missing PDF content" }, 400);
    }
    // Guard against oversized payloads (Resend caps attachments around 40MB).
    if (body.pdf_base64.length > 20_000_000) {
      return json({ error: "Report is too large to email. Narrow the date range." }, 413);
    }

    const title = esc(body.report_title || "Report");
    const subtitle = body.subtitle ? esc(body.subtitle) : "";

    const { error } = await resend.emails.send({
      from: "Matbex Reports <reports@matbex.com>",
      to: [recipient],
      subject: `${body.report_title || "Report"}${body.subtitle ? ` — ${body.subtitle}` : ""}`,
      html: `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1f23;line-height:1.6;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="border-left:4px solid #00A859;padding-left:12px;">
      <h1 style="margin:0;font-size:18px;font-weight:600;">${title}</h1>
      ${subtitle ? `<p style="margin:4px 0 0;color:#6e7680;font-size:13px;">${subtitle}</p>` : ""}
    </div>
    <p style="margin-top:20px;font-size:14px;">Your report is attached as a PDF.</p>
    <p style="margin-top:24px;color:#6e7680;font-size:12px;">Sent automatically by Matbex.</p>
  </div>
</body></html>`,
      attachments: [{ filename: body.file_name || "report.pdf", content: body.pdf_base64 }],
    });

    if (error) {
      console.error("email-report-pdf send failed", error);
      return json({ error: (error as { message?: string }).message ?? "Email delivery failed" }, 502);
    }

    return json({ success: true, sent_to: recipient });
  } catch (err) {
    console.error("email-report-pdf error", err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
};

serve(handler);
