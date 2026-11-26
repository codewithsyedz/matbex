import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// Closing a business and deleting its data (PDPL), for its owners.
// POST { action: "request", confirm_name, reason? }  starts a 30-day grace period; support is told
// POST { action: "cancel" }                           withdraws the pending request
// After the grace period a SuperAdmin erases the personal data (admin-tenant-erasure); tax records
// are kept as ZATCA requires. Status is read directly (tenant_deletion_requests, owners only).

import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { sendEmail } from "../../src/email/send.ts";
import { supportInbox } from "../_shared/support/notify.ts";

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let auth;
  try {
    auth = await requireUser(req);
  } catch (e) {
    if (e instanceof Response) return new Response(await e.text(), { status: e.status, headers: { ...cors, "Content-Type": "application/json" } });
    return json({ error: "Please sign in" }, 401);
  }
  const body = await req.json().catch(() => ({})) as { action?: string; confirm_name?: string; reason?: string };
  const db = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  const { data: profile } = await db.from("profiles").select("tenant_id").eq("id", auth.userId).maybeSingle();
  const tenantId = profile?.tenant_id as string | undefined;
  if (!tenantId) return json({ error: "Your account is not linked to a business" }, 400);
  const { data: owner } = await db.from("user_tenant_roles").select("role").eq("user_id", auth.userId).eq("tenant_id", tenantId).eq("role", "owner").limit(1);
  if (!owner?.length) return json({ error: "Only the business owner can close the account" }, 403);
  const { data: tenant } = await db.from("tenants").select("name").eq("id", tenantId).single();
  const name = String(tenant?.name ?? "");

  const tellSupport = (subject: string, text: string) =>
    sendEmail({
      to: supportInbox(), subject, template: "account-closure",
      html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto"><p>${text.replace(/[<>&]/g, "")}</p>
        <p><a href="${(env("SITE_URL") ?? "https://matbex.com").replace(/\/$/, "")}/admin/tenants/${tenantId}">Open the business in SuperAdmin</a></p></div>`,
      metadata: { tenant_id: tenantId },
    }).catch(() => undefined);

  if (body.action === "request") {
    if ((body.confirm_name ?? "").trim().toLowerCase() !== name.trim().toLowerCase()) {
      return json({ error: "Type the business name exactly to confirm" }, 400);
    }
    const reason = (body.reason ?? "").trim().slice(0, 500) || null;
    const { data: row, error } = await db.from("tenant_deletion_requests")
      .insert({ tenant_id: tenantId, requested_by: auth.userId, requested_by_email: auth.email, reason })
      .select("id, scheduled_for").single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return json({ error: "A closure request is already pending" }, 409);
      return json({ error: error.message }, 500);
    }
    await tellSupport(`Account closure requested: ${name}`,
      `${auth.email ?? "The owner"} asked to close ${name} and delete its data. Personal data can be erased from ${String(row.scheduled_for).slice(0, 10)}.${reason ? ` Reason: ${reason}` : ""}`);
    return json({ ok: true, scheduled_for: row.scheduled_for });
  }

  if (body.action === "cancel") {
    const { data, error } = await db.from("tenant_deletion_requests")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("status", "pending").select("id");
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ error: "There is no pending closure request" }, 404);
    await tellSupport(`Account closure cancelled: ${name}`, `${auth.email ?? "The owner"} cancelled the request to close ${name}.`);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
