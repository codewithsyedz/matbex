/**
 * Outbound email via Resend. Honours public.suppressed_emails and records
 * every attempt in public.email_send_log.
 */
import { Resend } from "resend";
import { config } from "../config.js";
import { sql } from "../db.js";

const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  template: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export type SendResult = { sent: true; id: string | null } | { sent: false; reason: "recipient_suppressed" | "not_configured" };

export async function sendEmail(msg: OutboundEmail): Promise<SendResult> {
  const recipient = msg.to.trim().toLowerCase();
  const [suppressed] = await sql`select 1 from public.suppressed_emails where lower(email) = ${recipient} limit 1`;
  if (suppressed) {
    await log(msg, "suppressed", null, null);
    return { sent: false, reason: "recipient_suppressed" };
  }
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — would send "${msg.subject}" to ${recipient}`);
    await log(msg, "failed", null, "RESEND_API_KEY not configured");
    return { sent: false, reason: "not_configured" };
  }
  const { data, error } = await resend.emails.send(
    {
      from: msg.from ?? config.EMAIL_FROM,
      to: recipient,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo: msg.replyTo,
    },
    msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : undefined,
  );
  if (error) {
    await log(msg, "failed", null, error.message);
    throw new Error(`Email send failed: ${error.message}`);
  }
  await log(msg, "sent", data?.id ?? null, null);
  return { sent: true, id: data?.id ?? null };
}

async function log(msg: OutboundEmail, status: string, messageId: string | null, err: string | null) {
  try {
    await sql`
      insert into public.email_send_log (message_id, template_name, recipient_email, status, error_message, metadata)
      values (${messageId}, ${msg.template}, ${msg.to}, ${status}, ${err}, ${sql.json((msg.metadata ?? {}) as any)})`;
  } catch (e) {
    console.error("[email] failed to write send log", e);
  }
}
