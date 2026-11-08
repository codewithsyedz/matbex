import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { requireSuperAdmin } from "../_shared/superadmin.ts";

import { buildCorsHeaders } from "../_shared/cors.ts";

// Request-scoped CORS headers. Assigned at the top of every request so the
// module-level response helpers below can spread them without a ReferenceError.
let corsHeaders: Record<string, string> = buildCorsHeaders(new Request("https://matbex.com"));
function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let caller;
  try {
    caller = await requireSuperAdmin(req);
  } catch (resp) {
    if (resp instanceof Response) {
      return new Response(resp.body, {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return j({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action;
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    if (action === "revoke") {
      const deviceId: string = body.device_id;
      if (!deviceId) return j({ error: "device_id required" }, 400);
      const { error } = await admin
        .from("device_licenses")
        .update({ revoked_at: new Date().toISOString(), revoked_by_user_id: caller.userId })
        .eq("id", deviceId)
        .is("revoked_at", null);
      if (error) throw error;
      return j({ ok: true });
    }

    if (action === "reset_restaurant") {
      const restaurantId: string = body.restaurant_id;
      if (!restaurantId) return j({ error: "restaurant_id required" }, 400);
      const { data, error } = await admin
        .from("device_licenses")
        .update({ revoked_at: new Date().toISOString(), revoked_by_user_id: caller.userId })
        .eq("restaurant_id", restaurantId)
        .is("revoked_at", null)
        .select("id");
      if (error) throw error;
      return j({ ok: true, revoked_count: data?.length ?? 0 });
    }

    return j({ error: "Unknown action" }, 400);
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
