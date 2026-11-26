import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Daily (server/src/jobs/schedules.ts): emails the owners of businesses on trial on trial days 1,
// 7 and 12 (Riyadh dates, day 0 = signup) with the setup steps they have not done yet.
//   day 1   getting started (skipped when every step is done)
//   day 7   one week in, what is left (skipped when every step is done)
//   day 12  the trial ends soon: choose a plan, plus anything still missing
// Emails go through the API's sender (suppression list, staging allow-list) with an idempotency
// key per business, day and address, so a second run the same day sends nothing new.

import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
import { sendEmail } from "../../src/email/send.ts";
import { ownerEmails } from "../_shared/billing/subscriptionInvoice.ts";
import { setupProgress, type SetupStep } from "../_shared/onboarding/setupProgress.ts";

export const TRIAL_EMAIL_DAYS = [1, 7, 12];
const RIYADH_MS = 3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const riyadhDay = (d: Date) => Math.floor((d.getTime() + RIYADH_MS) / DAY_MS);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function email(day: number, name: string, steps: SetupStep[], site: string, endsText: string | null, daysLeft: number | null) {
  const left = steps.filter((s) => !s.done);
  const doneCount = steps.length - left.length;
  const list = steps.map((s) => `<tr><td style="padding:8px 0;vertical-align:top;width:28px;font-size:18px">${s.done ? "✅" : "⬜"}</td>
    <td style="padding:8px 0">${s.done ? `<span style="color:#666">${esc(s.title)}</span>` : `<a href="${site}${s.path}" style="color:#1f5135;font-weight:600;text-decoration:none">${esc(s.title)}</a><br><span style="color:#555;font-size:13px">${esc(s.how)}</span>`}</td></tr>`).join("");
  const button = (label: string, url: string) =>
    `<p style="margin:20px 0"><a href="${url}" style="display:inline-block;background:#1f5135;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${label}</a></p>`;
  const wrap = (title: string, intro: string, cta: string) =>
    `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#111"><h2 style="margin:0 0 12px">${title}</h2>
    <p style="line-height:1.5">${intro}</p><table style="width:100%;border-collapse:collapse;font-size:14px">${list}</table>${cta}
    <p style="color:#666;font-size:13px">Questions? Reply to this email and our team will help you set up.</p></div>`;

  if (day === 1) {
    return {
      subject: `Getting started with Matbex: ${left.length} quick steps`,
      html: wrap(`Welcome to Matbex, ${esc(name)}`,
        "Here is what gets your restaurant running on Matbex. Most owners finish these in an afternoon.",
        button(`Start with: ${esc(left[0].title)}`, `${site}${left[0].path}`)),
    };
  }
  if (day === 7) {
    return {
      subject: `One week in: ${doneCount} of ${steps.length} setup steps done`,
      html: wrap(`One week with Matbex`,
        `<b>${esc(name)}</b> has finished ${doneCount} of ${steps.length} setup steps.${endsText ? ` Your free trial runs until ${endsText}.` : ""} Here is what is left:`,
        button(`Continue: ${esc(left[0].title)}`, `${site}${left[0].path}`)),
    };
  }
  return {
    subject: daysLeft != null && daysLeft <= 1 ? "Your Matbex trial ends tomorrow" : `Your Matbex trial ends in ${daysLeft ?? 2} days`,
    html: wrap(`Your trial ends ${endsText ? `on ${endsText}` : "soon"}`,
      `Choose a plan to keep using Matbex for <b>${esc(name)}</b> without interruption. Pay monthly, or yearly with 2 months free.${left.length ? " Still to do:" : " Your setup is complete."}`,
      button("Choose a plan", `${site}/billing`)),
  };
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const unauthorized = await guardCronCaller(req, cors);
  if (unauthorized) return unauthorized;

  const db = createClient(env("API_URL")!, env("SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const site = (env("SITE_URL") ?? "https://matbex.com").replace(/\/$/, "");
  const now = new Date();
  const today = riyadhDay(now);
  const summary = { checked: 0, day1: 0, day7: 0, day12: 0, skipped_complete: 0, emails: 0 };

  const { data: tenants, error } = await db.from("tenants").select("id, name, created_at, trial_ends_at").eq("status", "trial");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

  for (const t of tenants ?? []) {
    const day = today - riyadhDay(new Date(t.created_at));
    if (!TRIAL_EMAIL_DAYS.includes(day)) continue;
    summary.checked++;
    const steps = await setupProgress(db, t.id);
    if (day !== 12 && steps.every((s) => s.done)) { summary.skipped_complete++; continue; }
    const ends = t.trial_ends_at ? new Date(t.trial_ends_at) : null;
    const endsText = ends ? ends.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" }) : null;
    const daysLeft = ends ? Math.max(0, riyadhDay(ends) - today) : null;
    const mail = email(day, t.name, steps, site, endsText, daysLeft);
    (summary as Record<string, number>)[`day${day}`]++;
    for (const to of await ownerEmails(db, t.id)) {
      const r = await sendEmail({
        to, subject: mail.subject, html: mail.html, template: "trial-nurture",
        idempotencyKey: `trial-day-${day}-${t.id}-${to}`,
        metadata: { tenant_id: t.id, day, steps_done: steps.filter((s) => s.done).map((s) => s.key) },
      }).catch(() => ({ sent: false }));
      if (r.sent) summary.emails++;
    }
  }
  return new Response(JSON.stringify(summary), { headers: { ...cors, "Content-Type": "application/json" } });
});
