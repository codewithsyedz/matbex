import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
// SuperAdmin support desk (two-factor SuperAdmin sessions only).
//   list          requests (filter by status), newest activity first, with business names
//   get           one request: thread (incl. internal notes), context, the business's other requests
//   reply         answer the customer (emailed) or add an internal note; can mark it solved
//   set           status / priority / assign to me
//   start_access  begin a "View as Tenant" session: reason (or a request) required; logged in
//                 support_access_log (owners see it) and superadmin_audit_log
//   end_access    close that session

import { z } from "zod";
import { createClient } from "@matbex/client";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/superadmin.ts";
import { mailCustomer } from "../_shared/support/notify.ts";

const Body = z.union([
  z.object({ action: z.literal("list"), status: z.enum(["open", "waiting_on_customer", "resolved", "all"]).default("open") }),
  z.object({ action: z.literal("get"), request_id: z.string().uuid() }),
  z.object({ action: z.literal("reply"), request_id: z.string().uuid(), body: z.string().trim().min(1).max(5000), internal: z.boolean().default(false), resolve: z.boolean().default(false) }),
  z.object({
    action: z.literal("set"), request_id: z.string().uuid(),
    status: z.enum(["open", "waiting_on_customer", "resolved"]).optional(),
    priority: z.enum(["normal", "high", "urgent"]).optional(),
    assign_to_me: z.boolean().optional(),
  }),
  z.object({ action: z.literal("start_access"), tenant_id: z.string().uuid(), reason: z.string().trim().min(3).max(300), request_id: z.string().uuid().optional() }),
  z.object({ action: z.literal("end_access"), access_id: z.string().uuid() }),
]);

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
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  const body = parsed.data;
  const db = createClient(env("API_URL") ?? "", env("SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  const { data: me } = await db.from("profiles").select("full_name").eq("id", caller.userId).maybeSingle();
  const myName = me?.full_name || caller.email || "Matbex support";
  const audit = (action_type: string, tenantId: string, summary: string, context: Record<string, unknown>) =>
    db.from("superadmin_audit_log").insert({ actor_user_id: caller.userId, action_type, target_type: "tenant", target_identifier: tenantId, summary, context });

  try {
    if (body.action === "list") {
      let q = db.from("support_requests")
        .select("id, number, tenant_id, user_name, user_email, category, subject, status, priority, assigned_to, last_message_at, last_message_by, created_at, page_path, recent_errors, tenants:tenant_id(name)")
        .order("last_message_at", { ascending: false }).limit(200);
      if (body.status !== "all") q = q.eq("status", body.status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const { data: counts } = await db.from("support_requests").select("status");
      const by = (s: string) => (counts ?? []).filter((c: { status: string }) => c.status === s).length;
      return json({
        // deno-lint-ignore no-explicit-any
        requests: (data ?? []).map((r: any) => ({ ...r, tenant_name: r.tenants?.name ?? "", error_count: Array.isArray(r.recent_errors) ? r.recent_errors.length : 0, recent_errors: undefined, tenants: undefined })),
        counts: { open: by("open"), waiting_on_customer: by("waiting_on_customer"), resolved: by("resolved") },
      });
    }

    if (body.action === "get") {
      const { data: r } = await db.from("support_requests").select("*, tenants:tenant_id(name, status, plans:plan_id(name))").eq("id", body.request_id).maybeSingle();
      if (!r) return json({ error: "Request not found" }, 404);
      const [{ data: messages }, { data: others }, { data: access }] = await Promise.all([
        db.from("support_messages").select("id, author_kind, author_name, body, internal, created_at").eq("request_id", r.id).order("created_at"),
        db.from("support_requests").select("id, number, subject, status, created_at").eq("tenant_id", r.tenant_id).neq("id", r.id).order("created_at", { ascending: false }).limit(5),
        db.from("support_access_log").select("id, actor_name, reason, started_at, ended_at").eq("request_id", r.id).order("started_at", { ascending: false }),
      ]);
      // deno-lint-ignore no-explicit-any
      const t = (r as any).tenants;
      return json({ request: { ...r, tenants: undefined }, tenant: { id: r.tenant_id, name: t?.name ?? "", status: t?.status ?? null, plan: t?.plans?.name ?? null }, messages: messages ?? [], others: others ?? [], access: access ?? [] });
    }

    if (body.action === "reply") {
      const { data: r } = await db.from("support_requests").select("*, tenants:tenant_id(name)").eq("id", body.request_id).maybeSingle();
      if (!r) return json({ error: "Request not found" }, 404);
      const { error } = await db.from("support_messages").insert({
        request_id: r.id, author_id: caller.userId, author_kind: "support", author_name: body.internal ? myName : "Matbex support", body: body.body, internal: body.internal,
      });
      if (error) throw new Error(error.message);
      if (!body.internal) {
        const now = new Date().toISOString();
        await db.from("support_requests").update({
          status: body.resolve ? "resolved" : "waiting_on_customer", resolved_at: body.resolve ? now : null,
          last_message_at: now, last_message_by: "support", assigned_to: r.assigned_to ?? caller.userId,
        }).eq("id", r.id);
        // deno-lint-ignore no-explicit-any
        await mailCustomer({ id: r.id, number: r.number, subject: r.subject, category: r.category, tenant_name: (r as any).tenants?.name ?? "",
          user_name: r.user_name, user_email: r.user_email, page_path: r.page_path, recent_errors: [] }, body.body, body.resolve);
      }
      return json({ ok: true });
    }

    if (body.action === "set") {
      const patch: Record<string, unknown> = {};
      if (body.status) { patch.status = body.status; patch.resolved_at = body.status === "resolved" ? new Date().toISOString() : null; }
      if (body.priority) patch.priority = body.priority;
      if (body.assign_to_me) patch.assigned_to = caller.userId;
      if (!Object.keys(patch).length) return json({ error: "Nothing to change" }, 400);
      const { error } = await db.from("support_requests").update(patch).eq("id", body.request_id);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    if (body.action === "start_access") {
      const { data: t } = await db.from("tenants").select("id, name").eq("id", body.tenant_id).maybeSingle();
      if (!t) return json({ error: "Business not found" }, 404);
      if (body.request_id) {
        const { data: r } = await db.from("support_requests").select("id").eq("id", body.request_id).eq("tenant_id", t.id).maybeSingle();
        if (!r) return json({ error: "That request is not from this business" }, 400);
      }
      const { data: row, error } = await db.from("support_access_log").insert({
        tenant_id: t.id, actor_user_id: caller.userId, actor_name: myName, reason: body.reason, request_id: body.request_id ?? null,
      }).select("id").single();
      if (error || !row) throw new Error(error?.message ?? "Could not record the access");
      await audit("SUPPORT_ACCESS_STARTED", t.id, `Viewed ${t.name} as the business: ${body.reason}`, { access_id: row.id, request_id: body.request_id ?? null, reason: body.reason });
      return json({ ok: true, access_id: row.id });
    }

    // end_access
    const { data: a } = await db.from("support_access_log").update({ ended_at: new Date().toISOString() })
      .eq("id", body.access_id).eq("actor_user_id", caller.userId).is("ended_at", null).select("tenant_id").maybeSingle();
    if (a) await audit("SUPPORT_ACCESS_ENDED", a.tenant_id, "Stopped viewing as the business", { access_id: body.access_id });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Support action failed" }, 500);
  }
});
