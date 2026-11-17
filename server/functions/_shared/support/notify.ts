// Emails for help requests: new requests and customer replies go to Matbex support
// (SUPPORT_INBOX_EMAIL, default hello@matbex.com); support replies go to the customer.
// Never throws: a failed email must not lose the request.

import { env } from "../../_runtime/env.ts";
import { sendEmail } from "../../../src/email/send.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const site = () => (env("SITE_URL") ?? "https://matbex.com").replace(/\/$/, "");
export const supportInbox = () => env("SUPPORT_INBOX_EMAIL") ?? "hello@matbex.com";

const CATEGORY: Record<string, string> = { question: "Question", problem: "Something is not working", billing: "Billing", feature: "Feature request", other: "Other" };

export interface RequestForMail {
  id: string; number: number; subject: string; category: string; tenant_name: string; user_name: string | null; user_email: string | null;
  page_path: string | null; recent_errors: unknown[];
}

function page(title: string, intro: string, body: string, cta: string, url: string) {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#111"><h2 style="margin:0 0 8px">${title}</h2>
  <p style="color:#555;margin:0 0 12px">${intro}</p>
  <div style="white-space:pre-wrap;border-left:3px solid #ddd;padding:4px 12px;margin:0 0 16px">${esc(body)}</div>
  <p><a href="${url}" style="display:inline-block;background:#1f5135;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${cta}</a></p></div>`;
}

/** New request or a customer reply → Matbex support. */
export async function mailSupport(req: RequestForMail, message: string, kind: "new" | "reply") {
  const errors = Array.isArray(req.recent_errors) ? req.recent_errors.length : 0;
  const intro = `${esc(req.tenant_name)} · ${esc(req.user_name ?? req.user_email ?? "a user")} · ${CATEGORY[req.category] ?? req.category}`
    + `${req.page_path ? ` · on ${esc(req.page_path)}` : ""}${errors ? ` · ${errors} recent error${errors > 1 ? "s" : ""}` : ""}`;
  await sendEmail({
    to: supportInbox(),
    replyTo: req.user_email ?? undefined,
    subject: `${kind === "new" ? "New help request" : "Reply on"} #${req.number}: ${req.subject}`,
    html: page(`#${req.number} ${esc(req.subject)}`, intro, message, "Open in SuperAdmin", `${site()}/admin/support?request=${req.id}`),
    template: kind === "new" ? "support-request-new" : "support-request-reply",
    metadata: { request_id: req.id },
  }).catch((e) => console.error("[support] mail to support failed", e));
}

/** Support reply → the customer who asked. */
export async function mailCustomer(req: RequestForMail, message: string, resolved: boolean) {
  if (!req.user_email) return;
  await sendEmail({
    to: req.user_email,
    subject: `Re: ${req.subject} [#${req.number}]`,
    html: page(`Matbex support replied`, `About your request #${req.number} “${esc(req.subject)}”${resolved ? " (marked as solved)" : ""}:`,
      message, "View and reply", `${site()}/support?request=${req.id}`),
    template: "support-request-answer",
    metadata: { request_id: req.id },
  }).catch((e) => console.error("[support] mail to customer failed", e));
}
