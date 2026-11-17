import { serve } from "../_runtime/serve.ts";
// Help requests from inside the app (any signed-in member of a business).
// POST { action: "create", category, subject, message, page_path?, page_title?, branch_id?, viewport?, app_version? }
//      -> { id, number }   snapshots the user's client errors of the last hour, emails support
// POST { action: "reply", request_id, body }   reopens a solved request, emails support
// POST { action: "resolve", request_id }       the customer marks it solved
// Requests are read directly (RLS: own requests; owners see all of their business's).

import { z } from "zod";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { mailSupport } from "../_shared/support/notify.ts";

const Body = z.union([
  z.object({
    action: z.literal("create"),
    category: z.enum(["question", "problem", "billing", "feature", "other"]),
    subject: z.string().trim().min(3).max(150),
    message: z.string().trim().min(3).max(5000),
    page_path: z.string().max(300).optional(),
    page_title: z.string().max(200).optional(),
    branch_id: z.string().uuid().optional(),
    viewport: z.string().max(40).optional(),
    app_version: z.string().max(60).optional(),
  }),
  z.object({ action: z.literal("reply"), request_id: z.string().uuid(), body: z.string().trim().min(1).max(5000) }),
  z.object({ action: z.literal("resolve"), request_id: z.string().uuid() }),
]);

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
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  const body = parsed.data;
  const db = auth.db;

  try {
    const { data: profile } = await db.from("profiles").select("tenant_id, full_name").eq("id", auth.userId).maybeSingle();
    const tenantId = profile?.tenant_id as string | undefined;
    if (!tenantId) return json({ error: "Your account is not linked to a business" }, 400);
    const { data: member } = await db.from("user_tenant_roles").select("role").eq("user_id", auth.userId).eq("tenant_id", tenantId).limit(1);
    if (!member?.length) return json({ error: "Your account is not linked to a business" }, 403);
    const { data: tenant } = await db.from("tenants").select("name").eq("id", tenantId).single();
    const tenantName = tenant?.name ?? "";

    if (body.action === "create") {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { data: errs } = await db.from("client_errors")
        .select("occurred_at, route, error_name, error_message, release, severity")
        .eq("user_id", auth.userId).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(10);
      const { data: row, error } = await db.from("support_requests").insert({
        tenant_id: tenantId, user_id: auth.userId, user_email: auth.email, user_name: profile?.full_name ?? null,
        category: body.category, subject: body.subject,
        page_path: body.page_path ?? null, page_title: body.page_title ?? null, branch_id: body.branch_id ?? null,
        viewport: body.viewport ?? null, app_version: body.app_version ?? null,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
        recent_errors: errs ?? [],
        priority: body.category === "problem" && (errs?.length ?? 0) > 0 ? "high" : "normal",
      }).select("id, number").single();
      if (error || !row) throw new Error(error?.message ?? "Could not save the request");
      const { error: mErr } = await db.from("support_messages").insert({
        request_id: row.id, author_id: auth.userId, author_kind: "customer", author_name: profile?.full_name ?? auth.email, body: body.message,
      });
      if (mErr) throw new Error(mErr.message);
      await mailSupport({ id: row.id, number: row.number, subject: body.subject, category: body.category, tenant_name: tenantName,
        user_name: profile?.full_name ?? null, user_email: auth.email, page_path: body.page_path ?? null, recent_errors: errs ?? [] }, body.message, "new");
      return json({ id: row.id, number: row.number });
    }

    // reply / resolve: the request must be visible to this user (own, or any of the business's for owners).
    const { data: visible } = await auth.userClient.from("support_requests").select("id").eq("id", body.request_id).maybeSingle();
    const { data: r } = await db.from("support_requests").select("*").eq("id", body.request_id).eq("tenant_id", tenantId).maybeSingle();
    if (!visible || !r) return json({ error: "Request not found" }, 404);

    if (body.action === "resolve") {
      await db.from("support_requests").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", r.id);
      return json({ ok: true });
    }

    const { error } = await db.from("support_messages").insert({
      request_id: r.id, author_id: auth.userId, author_kind: "customer", author_name: profile?.full_name ?? auth.email, body: body.body,
    });
    if (error) throw new Error(error.message);
    await db.from("support_requests").update({
      status: "open", resolved_at: null, last_message_at: new Date().toISOString(), last_message_by: "customer",
    }).eq("id", r.id);
    await mailSupport({ id: r.id, number: r.number, subject: r.subject, category: r.category, tenant_name: tenantName,
      user_name: r.user_name, user_email: r.user_email, page_path: r.page_path, recent_errors: r.recent_errors ?? [] }, body.body, "reply");
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Help request failed" }, 500);
  }
});
