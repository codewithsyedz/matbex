import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

export interface AuthedRequest {
  userId: string;
  email: string | null;
  token: string;
  supabase: SupabaseClient; // service-role client
  userClient: SupabaseClient; // request-scoped client (RLS as caller)
}

/**
 * Validate the caller's JWT in-code (works regardless of verify_jwt setting).
 * Throws a Response on failure that the caller should return as-is.
 */
export async function requireUser(req: Request): Promise<AuthedRequest> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const token = authHeader.slice(7).trim();

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    token,
    supabase,
    userClient,
  };
}

/** Returns true if user has any of the given roles in user_tenant_roles for tenant. */
export async function userHasTenantRole(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  roles: string[],
): Promise<boolean> {
  const { data } = await supabase
    .from("user_tenant_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .in("role", roles)
    .maybeSingle();
  return !!data;
}