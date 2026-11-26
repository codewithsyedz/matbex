import { env } from "../_runtime/env.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const j = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { device_id } = await req.json();
    if (!device_id) return j({ error: "device_id required" }, 400);

    const db = createClient(
      env("API_URL") ?? "",
      env("SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "No auth" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData.user) return j({ error: "Invalid auth" }, 401);
    const user = userData.user;

    const { data: device } = await db
      .from("device_licenses")
      .select("id, tenant_id, revoked_at")
      .eq("id", device_id)
      .maybeSingle();
    if (!device) return j({ error: "Device not found" }, 404);
    if (device.revoked_at) return j({ ok: true, already_revoked: true });

    // Authorization: owner or manager of that tenant
    const { data: role } = await db
      .from("user_tenant_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("tenant_id", device.tenant_id)
      .in("role", ["owner", "manager"])
      .maybeSingle();
    if (!role) return j({ error: "Insufficient privileges" }, 403);

    const { error: updErr } = await db
      .from("device_licenses")
      .update({ revoked_at: new Date().toISOString(), revoked_by_user_id: user.id })
      .eq("id", device_id);
    if (updErr) throw updErr;

    return j({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return j({ error: msg }, 500);
  }
});