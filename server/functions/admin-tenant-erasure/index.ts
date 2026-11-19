import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// SuperAdmin (two-factor): erase a business's personal data once its owner's closure request has
// passed the 30-day grace period. Runs erase_tenant_personal_data (customers, staff, riders,
// guests, order contacts, supplier contacts, chat, sessions, user logins; the business is
// suspended; tax records kept for ZATCA's 6 years) and stores the record of what was done.
// POST { request_id, confirm_name }

import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/superadmin.ts";

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let caller;
  try {
    caller = await requireSuperAdmin(req);
  } catch (e) {
    if (e instanceof Response) return new Response(await e.text(), { status: e.status, headers: { ...cors, "Content-Type": "application/json" } });
    return json({ error: "SuperAdmin access required" }, 403);
  }
  const body = await req.json().catch(() => ({})) as { request_id?: string; confirm_name?: string };
  if (typeof body.request_id !== "string") return json({ error: "request_id required" }, 400);
  const db = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  const { data: r } = await db.from("tenant_deletion_requests").select("id, tenant_id, status, scheduled_for, tenants:tenant_id(name)").eq("id", body.request_id).maybeSingle();
  if (!r || r.status !== "pending") return json({ error: "No pending closure request" }, 404);
  // deno-lint-ignore no-explicit-any
  const name = String((r as any).tenants?.name ?? "");
  if ((body.confirm_name ?? "").trim().toLowerCase() !== name.trim().toLowerCase()) return json({ error: "Type the business name exactly to confirm" }, 400);

  const { data: summary, error } = await db.rpc("erase_tenant_personal_data", { _request_id: r.id, _actor: caller.userId });
  if (error) return json({ error: error.message }, 400);
  await db.from("superadmin_audit_log").insert({
    actor_user_id: caller.userId, action_type: "TENANT_PERSONAL_DATA_ERASED", target_type: "tenant", target_identifier: r.tenant_id,
    summary: `Erased the personal data of ${name} (owner's closure request)`, context: { request_id: r.id, summary },
  });
  return json({ ok: true, summary });
});
