import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Daily (server/src/jobs/schedules.ts): Matbex subscriptions paid through Moyasar are paid per
// period, so remind owners before the paid-until date and mark the account past due after it.
//   7, 3 and 1 day(s) before current_period_end -> reminder email with a link to Billing
//   on or after current_period_end, still active -> status past_due + email; the license allows a
//                                                   short grace period (validate-license)
// Emails go through the API's sender (suppression list, staging allow-list) with an idempotency
// key per account, period and reminder, so a second run the same day sends nothing new.

import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
import { sendEmail } from "../../src/email/send.ts";

const DAY = 24 * 3600 * 1000;
const REMIND_DAYS = [7, 3, 1];

function page(title: string, body: string, cta: string, url: string) {
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#111">
  <h2 style="margin:0 0 12px">${title}</h2><p style="line-height:1.5">${body}</p>
  <p><a href="${url}" style="display:inline-block;background:#1f5135;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${cta}</a></p>
  <p style="color:#666;font-size:13px">Pay with mada, Visa / Mastercard, Apple Pay or STC Pay. Monthly, or yearly with 2 months free.</p></div>`;
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const unauthorized = await guardCronCaller(req, cors);
  if (unauthorized) return unauthorized;

  const db = createClient(env("API_URL")!, env("SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const billingUrl = `${(env("SITE_URL") ?? "https://matbex.com").replace(/\/$/, "")}/billing`;
  const now = Date.now();

  const { data: tenants, error } = await db.from("tenants")
    .select("id, name, status, current_period_end")
    .eq("billing_provider", "moyasar").in("status", ["active", "past_due"]).not("current_period_end", "is", null);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

  const ownerEmails = async (tenantId: string) => {
    const { data: roles } = await db.from("user_tenant_roles").select("user_id").eq("tenant_id", tenantId).eq("role", "owner");
    const out: string[] = [];
    for (const r of roles ?? []) {
      const { data } = await db.auth.admin.getUserById(r.user_id);
      if (data?.user?.email) out.push(data.user.email);
    }
    return out;
  };

  const summary = { reminded: 0, expired: 0, emails: 0 };
  for (const t of tenants ?? []) {
    const end = new Date(t.current_period_end as string);
    const days = Math.ceil((end.getTime() - now) / DAY);
    const endText = end.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" });
    let mail: { key: string; subject: string; html: string } | null = null;

    if (end.getTime() <= now) {
      if (t.status === "active") {
        await db.from("tenants").update({ status: "past_due" }).eq("id", t.id).eq("status", "active");
        summary.expired++;
        mail = {
          key: "expired",
          subject: "Your Matbex plan has expired",
          html: page("Your Matbex plan has expired",
            `The paid period for <b>${t.name}</b> ended on ${endText}. Renew now to keep using Matbex without interruption; after a short grace period the account is limited.`,
            "Renew now", billingUrl),
        };
      }
    } else if (REMIND_DAYS.includes(days)) {
      summary.reminded++;
      mail = {
        key: `remind-${days}`,
        subject: days === 1 ? "Your Matbex plan ends tomorrow" : `Your Matbex plan ends in ${days} days`,
        html: page(`Your Matbex plan ends on ${endText}`,
          `<b>${t.name}</b> is paid until ${endText}. Renew before then to keep everything running; the new period starts when the current one ends, so nothing is lost by renewing early.`,
          "Renew", billingUrl),
      };
    }
    if (!mail) continue;
    for (const to of await ownerEmails(t.id)) {
      const r = await sendEmail({
        to, subject: mail.subject, html: mail.html, template: "subscription-renewal",
        idempotencyKey: `subscription-${mail.key}-${t.id}-${end.toISOString().slice(0, 10)}-${to}`,
        metadata: { tenant_id: t.id, kind: mail.key },
      }).catch(() => ({ sent: false }));
      if (r.sent) summary.emails++;
    }
  }

  return new Response(JSON.stringify(summary), { headers: { ...cors, "Content-Type": "application/json" } });
});
